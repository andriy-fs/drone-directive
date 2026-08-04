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
  private ws: WebSocket | null = null;
  private started = false;
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
  /** Which room to re-attach to, and the token proving which seat is ours. */
  private roomCode = '';
  private resumeToken: string | null = null;
  /** Every tick frame sent but not yet provably received; replayed on resume. */
  private readonly outbox = new Map<number, Uint8Array<ArrayBuffer>>();
  /** Highest tick the peer has sent — how far it got, which is what it acknowledges. */
  private peerHighTick = -1;
  /** Highest tick already consumed by `take`; anything at or below it is history. */
  private consumedThrough = -1;
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the relay stops holding our seat. Set the moment the link goes down. */
  private resumeDeadline = 0;
  /** True between the drop and the successful re-attach — keeps the callbacks paired. */
  private linkDown = false;

  constructor(handlers: LockstepHandlers, config: LockstepConfig) {
    this.handlers = handlers;
    this.config = config;
  }

  get isStarted(): boolean {
    return this.started;
  }

  connectHost(roomCode: string, mapSize: MapSize, aiCount: number): void {
    this.roomCode = roomCode;
    this.open(() => connectUrl(this.config.relayUrl, { room: roomCode, create: true, mapSize, aiCount }));
  }

  connectGuest(roomCode: string): void {
    this.roomCode = roomCode;
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
    if (ws !== this.ws || !this.linkDown) return; // the first connect has nothing to replay
    for (const tick of [...this.outbox.keys()].sort((a, b) => a - b)) {
      const frameBytes = this.outbox.get(tick);
      if (frameBytes) this.send(frameBytes);
    }
    this.linkDown = false;
    this.retryIndex = 0;
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
      case 'start':
        this.started = true;
        this.resumeToken = msg.resumeToken;
        // No coercion left to do: the schema pinned `seed` to a u32 and `mapSize`
        // to one of three tags, which the codec already turned into a `MapSize`.
        this.handlers.onStart?.(msg.seed, msg.mapSize, msg.aiCount, msg.chatId);
        break;
      case 'tick':
        // A resumed socket replays frames we may already have consumed; they are
        // dropped here rather than left to settle in a buffer nothing reads.
        if (msg.tick > this.consumedThrough) this.peerBuffer.set(msg.tick, screen(msg, this.config.limits()));
        this.acknowledge(msg.tick);
        if (msg.check) this.checkPeerHash(msg.check);
        break;
      case 'opponentLeft':
        this.abandonResume();
        this.handlers.onOpponentLeft?.();
        break;
      case 'error':
        // Including a refused resume: whatever the relay objects to at this point,
        // retrying it would only produce the same answer.
        this.abandonResume();
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
    if (!this.started || !this.resumeToken) {
      this.handlers.onClose?.();
      return;
    }
    if (!this.linkDown) {
      this.linkDown = true;
      this.retryIndex = 0;
      this.resumeDeadline = Date.now() + RESUME_GRACE_MS;
      this.handlers.onLinkDown?.();
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.retryIndex, RETRY_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    // An attempt landing after the relay has dropped the seat can only be refused,
    // so stop at the deadline rather than spend a round trip proving it.
    if (Date.now() + delay >= this.resumeDeadline) {
      this.abandonResume();
      this.handlers.onClose?.();
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const token = this.resumeToken;
      if (!token) return; // given up while the timer was pending
      this.open(() => connectUrl(this.config.relayUrl, { room: this.roomCode, resume: token }));
    }, delay);
  }

  /** Stop trying to come back: the seat is gone, refused, or no longer wanted. */
  private abandonResume(): void {
    this.resumeToken = null;
    this.linkDown = false;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  disconnect(): void {
    this.started = false;
    this.localBuffer.clear();
    this.peerBuffer.clear();
    this.localHashes.clear();
    this.outbox.clear();
    this.pendingCheck = null;
    this.desyncReported = false;
    this.peerHighTick = -1;
    this.consumedThrough = -1;
    this.abandonResume();
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
