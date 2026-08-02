import type { MapSize } from '@drone-directive/types/enums';
import { connectUrl, INPUT_DELAY_TICKS } from '../config';
import { decodeServerMessage, encodeTick, ErrorCode, type WorldCheck } from '../wire/codec';
import { parseCommands } from '../wire/validation';
import { emptyInput, screen } from './input';
import type { LockstepConfig, LockstepHandlers, TickInput } from './types';

/**
 * Client-side lockstep transport: owns the relay WebSocket, buffers both the local
 * and the peer's per-tick inputs by tick number, and answers "are both sides ready
 * for tick N?". `GameApp.step()` drives it — scheduling local input for
 * `tick + INPUT_DELAY_TICKS`, then advancing the sim only once both sides' inputs
 * for the current tick have arrived (else it stalls, the standard lockstep wait).
 * Ticks below the delay have no scheduled input (implicitly empty on both sides).
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

  constructor(handlers: LockstepHandlers, config: LockstepConfig) {
    this.handlers = handlers;
    this.config = config;
  }

  get isStarted(): boolean {
    return this.started;
  }

  connectHost(roomCode: string, mapSize: MapSize, aiCount: number): void {
    this.open(() => connectUrl(this.config.relayUrl, { room: roomCode, create: true, mapSize, aiCount }));
  }

  connectGuest(roomCode: string): void {
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
    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.handlers.onClose?.());
    // Connection failures surface through the subsequent `close` event.
    ws.addEventListener('error', () => {});
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
        // No coercion left to do: the schema pinned `seed` to a u32 and `mapSize`
        // to one of three tags, which the codec already turned into a `MapSize`.
        this.handlers.onStart?.(msg.seed, msg.mapSize, msg.aiCount);
        break;
      case 'tick':
        this.peerBuffer.set(msg.tick, screen(msg, this.config.limits()));
        if (msg.check) this.checkPeerHash(msg.check);
        break;
      case 'opponentLeft':
        this.handlers.onOpponentLeft?.();
        break;
      case 'error':
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
   * empty).
   *
   * The local batch goes through the same validator as the peer's, and it has to:
   * under lockstep an asymmetric filter is itself a desync source. A command this
   * client applied but the peer's validator rejected would leave the two
   * simulations running different worlds — so both sides screen both batches with
   * the same rules, the same argument as `isCommandFrom` in `GameApp.stepOnline`.
   */
  scheduleLocal(tick: number, input: TickInput): void {
    const commands = parseCommands(input.commands, 'local', this.config.limits());
    this.localBuffer.set(tick, { commands, drone: input.drone });
    const check = this.pendingCheck;
    this.pendingCheck = null;
    this.send(encodeTick(tick, commands, input.drone, check));
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

  disconnect(): void {
    this.started = false;
    this.localBuffer.clear();
    this.peerBuffer.clear();
    this.localHashes.clear();
    this.pendingCheck = null;
    this.desyncReported = false;
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
