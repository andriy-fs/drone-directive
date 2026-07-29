import type { ErrorCode, ServerMessage, TickMessage, WireDroneControl, WorldCheck } from '@drone-directive/protocol';
import type { DroneControl } from '../../engine/game/context';
import type { Command } from '../../types/commands';
import type { MapSize } from '../../types/enums';
import { connectUrl, INPUT_DELAY_TICKS } from './config';

/** One tick's worth of a single side's input (buffered locally, sent over the wire). */
export interface TickInput {
  commands: Command[];
  drone: DroneControl;
}

export interface LockstepHandlers {
  /** Host only: the room is open and waiting for a guest. */
  onCreated?: (roomCode: string) => void;
  /** Both sockets present — start simulating from this seed + map size. */
  onStart?: (seed: number, mapSize: MapSize, aiCount: number) => void;
  /** The peer disconnected; the match is over. */
  onOpponentLeft?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
  /** The socket closed (network drop or intentional disconnect). */
  onClose?: () => void;
  /**
   * The peer's world hash for `tick` disagreed with ours: the simulations have
   * parted. Everything either client shows after this point is unreliable.
   */
  onDesync?: (tick: number, mine: number, theirs: number) => void;
}

function emptyInput(): TickInput {
  return { commands: [], drone: { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false } };
}

function toWire(d: DroneControl): WireDroneControl {
  return { dir: { x: d.dir.x, y: d.dir.y }, possess: d.possessPulse, fire: d.firePulse };
}

function fromWire(msg: TickMessage): TickInput {
  return {
    commands: msg.commands as Command[],
    drone: { dir: { x: msg.drone.dir.x, y: msg.drone.dir.y }, possessPulse: msg.drone.possess, firePulse: msg.drone.fire },
  };
}

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
  private readonly localBuffer = new Map<number, TickInput>();
  private readonly peerBuffer = new Map<number, TickInput>();
  /** Our own world hashes by tick, kept until the peer's probe for them arrives. */
  private readonly localHashes = new Map<number, number>();
  /** The next probe to piggyback on an outgoing tick message. */
  private pendingCheck: WorldCheck | null = null;
  private desyncReported = false;

  constructor(handlers: LockstepHandlers) {
    this.handlers = handlers;
  }

  get isStarted(): boolean {
    return this.started;
  }

  connectHost(roomCode: string, mapSize: MapSize, aiCount: number): void {
    this.open(() => connectUrl({ room: roomCode, create: true, mapSize, aiCount }));
  }

  connectGuest(roomCode: string): void {
    this.open(() => connectUrl({ room: roomCode }));
  }

  private open(buildUrl: () => string): void {
    let ws: WebSocket;
    try {
      // Both `connectUrl` (new URL) and `new WebSocket` throw on a malformed URL —
      // surface it as a lobby error instead of letting it kill the game loop.
      ws = new WebSocket(buildUrl());
    } catch {
      this.handlers.onError?.('bad-message', 'Invalid multiplayer server URL — check VITE_MULTIPLAYER_URL.');
      return;
    }
    this.ws = ws;
    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.handlers.onClose?.());
    // Connection failures surface through the subsequent `close` event.
    ws.addEventListener('error', () => {});
  }

  private onMessage(e: MessageEvent): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case 'created':
        this.handlers.onCreated?.(msg.roomCode);
        break;
      case 'start':
        this.started = true;
        this.handlers.onStart?.(msg.seed >>> 0, msg.mapSize as MapSize, msg.aiCount);
        break;
      case 'tick':
        this.peerBuffer.set(msg.tick, fromWire(msg));
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

  /** Buffer local input for `tick` and send it to the peer (a heartbeat even when empty). */
  scheduleLocal(tick: number, input: TickInput): void {
    this.localBuffer.set(tick, input);
    const check = this.pendingCheck ?? undefined;
    this.pendingCheck = null;
    this.send({ type: 'tick', tick, commands: input.commands, drone: toWire(input.drone), check });
  }

  /** Compare a peer probe against our own hash for that tick (once — the first is the real one). */
  private checkPeerHash(check: WorldCheck): void {
    if (this.desyncReported) return;
    const mine = this.localHashes.get(check.tick);
    if (mine === undefined || mine === check.hash) return;
    this.desyncReported = true;
    this.handlers.onDesync?.(check.tick, mine, check.hash);
  }

  private send(msg: TickMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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
