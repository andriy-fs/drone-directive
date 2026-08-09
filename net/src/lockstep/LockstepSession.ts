import { RESUME_BUFFER_FRAMES, RESUME_GRACE_MS } from '@drone-directive/protocol';
import type { MapSize } from '@drone-directive/types/enums';
import { connectUrl, INPUT_DELAY_TICKS } from '../config';
import { decodeServerMessage, encodeTick, ErrorCode, type WorldCheck } from '../wire/codec';
import { parseCommands } from '../wire/validation';
import { emptyInput, screen } from './input';
import type { LockstepConfig, LockstepHandlers, TickInput } from './types';

/**
 * How long to wait before each attempt at reclaiming a dropped seat. Short at
 * first — most drops are a few hundred milliseconds of nothing — then backing off
 * so a genuinely dead link is not hammered for the whole grace period. The last
 * delay repeats; `RESUME_GRACE_MS` is what actually ends the schedule.
 */
const RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000];

/**
 * The four phases of a session's life, as the frozen const map the rest of the
 * project uses for enum-like values (see `types/src/enums.ts`). Naming them is
 * what makes a comparison read as one: `state.phase === Phase.Connecting` says
 * which vocabulary the value is drawn from and where to find the other members,
 * which a bare `=== 'connecting'` leaves the reader to work out.
 *
 * No companion union type, unlike `enums.ts`: nothing here annotates a phase on
 * its own — `SessionState`'s members carry it as `typeof Phase.Live` — and
 * nothing outside this file ever sees one.
 */
const Phase = {
  /** No session: freshly constructed, disconnected, or given up on. */
  Idle: 'idle',
  /** A socket is opening and the match has not begun. */
  Connecting: 'connecting',
  /** In a match, with a seat that can be reclaimed. */
  Live: 'live',
  /** Mid-match, the socket dropped and the seat is being reclaimed. */
  Resuming: 'resuming',
} as const;

/**
 * Where the session is in its life, and what only that phase has.
 *
 * This used to be six independent fields — `started`, `resumeToken`, `linkDown`,
 * `retryIndex`, `retryTimer`, `resumeDeadline` — written from five different
 * methods. Between them they could spell out states no session is ever in: a
 * retry scheduled with no seat left to reclaim, a link "down" before the match
 * began, a deadline belonging to a resume nobody is attempting. Each of those was
 * ruled out by a check at the top of whichever method would have tripped over it.
 *
 * As one field the phases are exclusive by construction, and each carries exactly
 * what it needs — a resume attempt cannot exist without the token it presents or
 * the deadline that ends it, because they are the same object.
 *
 * The socket is deliberately **not** in here. It is the identity of the current
 * attempt rather than a phase, and every state may or may not have one open:
 * `idle` still holds a live socket after a refused resume, until the host gets
 * round to `disconnect()`. Keeping it out is what lets `ws !== this.ws` stay the
 * one-line test for "a socket we already replaced or gave up on".
 */
type SessionState =
  | { phase: typeof Phase.Idle }
  /**
   * Host and guest share this one phase: `created` tells the lobby its room code
   * without changing anything here, because nothing about the transport differs
   * between waiting for a guest and waiting for `start`.
   */
  | { phase: typeof Phase.Connecting; roomCode: string }
  /** `resumeToken` names the seat to come back to if the socket drops. */
  | { phase: typeof Phase.Live; roomCode: string; resumeToken: string }
  /**
   * How many attempts have gone (indexing `RETRY_DELAYS_MS`), when the relay stops
   * holding the seat, and the pending attempt while one is scheduled.
   */
  | {
      phase: typeof Phase.Resuming;
      roomCode: string;
      resumeToken: string;
      retryIndex: number;
      deadline: number;
      timer: ReturnType<typeof setTimeout> | null;
    };

/**
 * Client-side lockstep transport: owns the relay WebSocket, buffers both the local
 * and the peer's per-tick inputs by tick number, and answers "are both sides ready
 * for tick N?". `GameApp.step()` drives it — scheduling local input for
 * `tick + INPUT_DELAY_TICKS`, then advancing the sim only once both sides' inputs
 * for the current tick have arrived (else it stalls, the standard lockstep wait).
 * Ticks below the delay have no scheduled input (implicitly empty on both sides).
 *
 * A socket that drops mid-match is not the end of it. Neither peer can advance
 * without the other's input, so a disconnected client falls exactly zero ticks
 * behind — nothing has to be rewound or caught up, only re-delivered. The session
 * therefore keeps the frames it has sent and re-attaches with the seat's
 * `resumeToken` until the relay's grace period runs out; only then is the match
 * really over. (Chat's socket reconnects too, for the opposite reason: its state
 * lives on the server rather than in a pair of simulations.)
 */
export class LockstepSession {
  readonly inputDelay = INPUT_DELAY_TICKS;
  /** Which phase this session is in, and everything that phase alone owns. */
  private state: SessionState = { phase: Phase.Idle };
  /** The socket of the current attempt — see `SessionState` for why it sits outside it. */
  private ws: WebSocket | null = null;
  private readonly handlers: LockstepHandlers;
  private readonly config: LockstepConfig;
  private readonly localBuffer = new Map<number, TickInput>();
  private readonly peerBuffer = new Map<number, TickInput>();
  /** Our own world hashes by tick, kept until the peer's probe for them arrives. */
  private readonly localHashes = new Map<number, number>();
  /** The next probe to piggyback on an outgoing tick message. */
  private pendingCheck: WorldCheck | null = null;
  private desyncReported = false;

  // --- Resuming a dropped seat ------------------------------------------------
  /** Every tick frame sent but not yet provably received; replayed on resume. */
  private readonly outbox = new Map<number, Uint8Array<ArrayBuffer>>();
  /** Highest tick the peer has sent — how far it got, which is what it acknowledges. */
  private peerHighTick = -1;
  /** Highest tick already consumed by `take`; anything at or below it is history. */
  private consumedThrough = -1;

  constructor(handlers: LockstepHandlers, config: LockstepConfig) {
    this.handlers = handlers;
    this.config = config;
  }

  /**
   * Is there a match to step? A reconnect in progress still counts: neither world
   * has advanced past the tick they both stopped on, so the host keeps stepping
   * (and stalling) exactly as it does for a slow peer.
   */
  get isStarted(): boolean {
    return this.state.phase === Phase.Live || this.state.phase === Phase.Resuming;
  }

  connectHost(roomCode: string, mapSize: MapSize, aiCount: number): void {
    this.transition({ phase: Phase.Connecting, roomCode });
    this.open(() => connectUrl(this.config.relayUrl, { room: roomCode, create: true, mapSize, aiCount }));
  }

  connectGuest(roomCode: string): void {
    this.transition({ phase: Phase.Connecting, roomCode });
    this.open(() => connectUrl(this.config.relayUrl, { room: roomCode }));
  }

  private open(buildUrl: () => string): void {
    let ws: WebSocket;
    try {
      // Both `connectUrl` (new URL) and `new WebSocket` throw on a malformed URL —
      // surface it as a lobby error instead of letting it kill the game loop.
      ws = new WebSocket(buildUrl());
    } catch {
      this.handlers.onError?.(ErrorCode.BadMessage, 'Invalid multiplayer server URL.');
      return;
    }
    this.ws = ws;
    // Frames are BARE, not text; without this they arrive as `Blob` and can only
    // be read asynchronously, which the per-tick path has no room for.
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => this.onOpen(ws));
    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.onSocketClosed(ws));
    // Connection failures surface through the subsequent `close` event.
    ws.addEventListener('error', () => {});
  }

  /**
   * A reconnect's socket is live: replay whatever the drop swallowed. Sending
   * before the relay has had a chance to refuse the token is harmless — it closes
   * the socket in that case and the frames go nowhere.
   */
  private onOpen(ws: WebSocket): void {
    const state = this.state;
    if (ws !== this.ws || state.phase !== Phase.Resuming) return; // the first connect has nothing to replay
    for (const tick of [...this.outbox.keys()].sort((a, b) => a - b)) {
      const frameBytes = this.outbox.get(tick);
      if (frameBytes) this.send(frameBytes);
    }
    // Back to plain `live`: the attempt count, the deadline and any timer belonged
    // to the drop, and go with it rather than being reset one by one.
    this.transition({ phase: Phase.Live, roomCode: state.roomCode, resumeToken: state.resumeToken });
    this.handlers.onLinkUp?.();
  }

  private onMessage(e: MessageEvent): void {
    if (!(e.data instanceof ArrayBuffer)) return; // text on a binary protocol — not ours
    const msg = decodeServerMessage(e.data);
    if (!msg) return; // not a well-formed protocol message — ignore it, don't die on it
    switch (msg.type) {
      case 'created':
        this.handlers.onCreated?.(msg.roomCode);
        break;
      case 'start': {
        // Only ever the first one. `Room.acceptResume` replays the frames the drop
        // swallowed and nothing else — a second `start` is not something the relay
        // sends, and acting on one would restart a match already in progress.
        const state = this.state;
        if (state.phase !== Phase.Connecting) break;
        this.transition({ phase: Phase.Live, roomCode: state.roomCode, resumeToken: msg.resumeToken });
        // No coercion left to do: the schema pinned `seed` to a u32 and `mapSize`
        // to one of three tags, which the codec already turned into a `MapSize`.
        this.handlers.onStart?.(msg.seed, msg.mapSize, msg.aiCount, msg.chatId);
        break;
      }
      case 'tick':
        // A resumed socket replays frames we may already have consumed; they are
        // dropped here rather than left to settle in a buffer nothing reads.
        if (msg.tick > this.consumedThrough) this.peerBuffer.set(msg.tick, screen(msg, this.config.limits()));
        this.acknowledge(msg.tick);
        if (msg.check) this.checkPeerHash(msg.check);
        break;
      case 'opponentLeft':
        this.abandon();
        this.handlers.onOpponentLeft?.();
        break;
      case 'error':
        // Including a refused resume: whatever the relay objects to at this point,
        // retrying it would only produce the same answer.
        this.abandon();
        this.handlers.onError?.(msg.code, msg.message);
        break;
    }
  }

  /** True once both sides' inputs for `tick` are available (ticks below the delay are implicitly empty). */
  ready(tick: number): boolean {
    if (tick < this.inputDelay) return true;
    return this.localBuffer.has(tick) && this.peerBuffer.has(tick);
  }

  /** Consume and return both sides' inputs for `tick`, freeing the buffers. */
  take(tick: number): { local: TickInput; peer: TickInput } {
    const local = this.localBuffer.get(tick) ?? emptyInput();
    const peer = this.peerBuffer.get(tick) ?? emptyInput();
    this.localBuffer.delete(tick);
    this.peerBuffer.delete(tick);
    this.consumedThrough = Math.max(this.consumedThrough, tick);
    return { local, peer };
  }

  /**
   * Record our world hash for an already-simulated tick. It rides along on the
   * next outgoing tick message, and is kept locally so the peer's matching probe
   * has something to compare against whichever direction arrives first.
   */
  recordHash(tick: number, hash: number): void {
    this.localHashes.set(tick, hash);
    this.pendingCheck = { tick, hash };
    // Bound the map: probes cross within a few ticks of each other, so anything
    // much older than the input delay will never be asked about.
    for (const t of this.localHashes.keys()) {
      if (t < tick - this.inputDelay * 20) this.localHashes.delete(t);
    }
  }

  /**
   * Buffer local input for `tick` and send it to the peer (a heartbeat even when
   * empty, and one that keeps running while the match is paused — the pause is
   * lifted by a bit riding on these frames).
   *
   * The local batch goes through the same validator as the peer's, and it has to:
   * under lockstep an asymmetric filter is itself a desync source. A command this
   * client applied but the peer's validator rejected would leave the two
   * simulations running different worlds — so both sides screen both batches with
   * the same rules, the same argument as `isCommandFrom` in `GameApp.stepOnline`.
   */
  scheduleLocal(tick: number, input: TickInput): void {
    const commands = parseCommands(input.commands, 'local', this.config.limits());
    const screened = { commands, drone: input.drone, pauseToggle: input.pauseToggle };
    this.localBuffer.set(tick, screened);
    const check = this.pendingCheck;
    this.pendingCheck = null;
    const frameBytes = encodeTick(tick, screened, check);
    // Kept whether or not the socket takes it: a frame written into a socket that
    // is already gone is exactly what a resume has to make good.
    this.outbox.set(tick, frameBytes);
    this.pruneOutbox();
    this.send(frameBytes);
  }

  /**
   * The peer reached `tick`, which under lockstep it could not have done without
   * our input for `tick - inputDelay`. That makes its own tick stream the only
   * acknowledgement this protocol needs, and the outbox shrinks to whatever is
   * genuinely still in flight.
   */
  private acknowledge(tick: number): void {
    if (tick > this.peerHighTick) this.peerHighTick = tick;
    this.pruneOutbox();
  }

  private pruneOutbox(): void {
    const acknowledged = this.peerHighTick - this.inputDelay;
    // The count cap only matters while the peer is away and acknowledging nothing;
    // it bounds the outbox by the same figure the relay bounds its own buffer.
    const oldest = Math.max(acknowledged, (this.peerHighTick > 0 ? this.peerHighTick : 0) - RESUME_BUFFER_FRAMES);
    for (const t of this.outbox.keys()) {
      if (t <= oldest) this.outbox.delete(t);
    }
  }

  /** Compare a peer probe against our own hash for that tick (once — the first is the real one). */
  private checkPeerHash(check: WorldCheck): void {
    if (this.desyncReported) return;
    const mine = this.localHashes.get(check.tick);
    if (mine === undefined || mine === check.hash) return;
    this.desyncReported = true;
    this.handlers.onDesync?.(check.tick, mine, check.hash);
  }

  private send(frameBytes: Uint8Array<ArrayBuffer>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(frameBytes);
  }

  /**
   * The socket closed. Mid-match that is a link failure rather than the end: the
   * relay holds the seat for `RESUME_GRACE_MS`, the peer stalls meanwhile, and
   * this schedules the attempts to get it back. Everywhere else — the lobby, a
   * refused handshake, an opponent who left — there is nothing to resume, so it
   * still means what it always did.
   */
  private onSocketClosed(ws: WebSocket): void {
    if (ws !== this.ws) return; // a socket we already replaced or gave up on
    this.ws = null;
    const state = this.state;
    switch (state.phase) {
      case Phase.Idle:
      case Phase.Connecting:
        // Nothing to resume: there is no seat yet, or there is no longer one.
        this.abandon();
        this.handlers.onClose?.();
        return;
      case Phase.Live:
        // The seat is held for `RESUME_GRACE_MS` from right now — which is the one
        // moment that deadline can be set, and the only state that can set it.
        this.transition({
          phase: Phase.Resuming,
          roomCode: state.roomCode,
          resumeToken: state.resumeToken,
          retryIndex: 0,
          deadline: Date.now() + RESUME_GRACE_MS,
          timer: null,
        });
        this.handlers.onLinkDown?.();
        this.scheduleRetry();
        return;
      case Phase.Resuming:
        // An attempt that closed on us; `onLinkDown` has already been sent.
        this.scheduleRetry();
        return;
    }
  }

  private scheduleRetry(): void {
    const state = this.state;
    if (state.phase !== Phase.Resuming || state.timer !== null) return;
    const delay = RETRY_DELAYS_MS[Math.min(state.retryIndex, RETRY_DELAYS_MS.length - 1)];
    state.retryIndex += 1;
    // An attempt landing after the relay has dropped the seat can only be refused,
    // so stop at the deadline rather than spend a round trip proving it.
    if (Date.now() + delay >= state.deadline) {
      this.abandon();
      this.handlers.onClose?.();
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = null;
      // Anything that ended this attempt — a refusal, the deadline, the host
      // hanging up — replaced the state object, and this timer is its leftover.
      if (this.state !== state) return;
      this.open(() => connectUrl(this.config.relayUrl, { room: state.roomCode, resume: state.resumeToken }));
    }, delay);
  }

  /**
   * The one way the phase ever changes, and the reason it is a method rather than
   * an assignment: whatever we are leaving lets go of its pending attempt on the
   * way out. `resuming` has three exits — reconnected, refused, out of time — and
   * every one of them used to have to remember this for itself. A fourth exit
   * that forgot would leave a timer alive to open a socket for a match that no
   * longer exists.
   */
  private transition(next: SessionState): void {
    const leaving = this.state;
    if (leaving.phase === Phase.Resuming && leaving.timer !== null) {
      clearTimeout(leaving.timer);
      leaving.timer = null;
    }
    this.state = next;
  }

  /** Stop: the seat is gone, refused, or no longer wanted — and there is no other way back. */
  private abandon(): void {
    this.transition({ phase: Phase.Idle });
  }

  disconnect(): void {
    this.abandon();
    this.localBuffer.clear();
    this.peerBuffer.clear();
    this.localHashes.clear();
    this.outbox.clear();
    this.pendingCheck = null;
    this.desyncReported = false;
    this.peerHighTick = -1;
    this.consumedThrough = -1;
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'left');
      } catch {
        /* already closing */
      }
    }
  }
}
