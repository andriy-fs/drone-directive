/**
 * Wire protocol for online matches between two human players — the single source of truth for the
 * messages exchanged between the game clients and the relay Worker. Deliberately
 * free of any game-engine imports so both `@drone-directive/client` and
 * `@drone-directive/server` can depend on it without pulling in the other.
 *
 * The relay is intentionally dumb: it pairs two sockets per room, generates the
 * shared seed once both are present, and forwards `tick` messages verbatim. Per-
 * tick game commands ride as opaque JSON (`WireCommand[]`) — their concrete shape
 * (the client's `Command`) is a client-only concern the relay never inspects. See
 * `.docs/multiplayer.md`.
 */

/** Bumped on any breaking wire change; clients send it, the relay rejects mismatches. */
export const PROTOCOL_VERSION = 3;

/** Room codes: fixed length, drawn from an unambiguous alphabet (no 0/O/1/I). */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Connection contract. A WebSocket must target a specific room before it opens, so
 * the create/join intent travels as URL query params rather than as messages:
 *   host:  `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>&ai=<0-2>`
 *   guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`
 */
export const QueryParam = {
  Room: 'room',
  Create: 'create',
  Version: 'v',
  MapSize: 'mapSize',
  /** Bot-controlled sides joining the two humans, `0..MAX_AI_OPPONENTS`. */
  Ai: 'ai',
} as const;

/**
 * Most bots a networked match can seat. The map deals one corner per side and the
 * two humans already hold two of the four.
 */
export const MAX_AI_OPPONENTS = 2;

/** Map presets — mirrors the client's `MapSize` union (identical string values). */
export type WireMapSize = 'small' | 'medium' | 'large';

/**
 * One game command as it crosses the wire. Opaque to the relay; the client
 * narrows it back to its own `Command` type on receipt.
 */
export type WireCommand = unknown;

/**
 * The observer-drone input for one tick (continuous flight dir + one-shot
 * possess/fire pulses). Networked so both players can pilot their own drone under
 * lockstep — mirrors the client's `DroneControl`.
 */
export interface WireDroneControl {
  dir: { x: number; y: number };
  possess: boolean;
  fire: boolean;
}

// ---------------------------------------------------------------------------
// Client → relay (after the match has started)
// ---------------------------------------------------------------------------

/**
 * One simulation tick's worth of locally-issued commands (may be empty — the
 * per-tick heartbeat). Sent client→relay, rebroadcast relay→peer verbatim, so it
 * appears in both directions.
 */
export interface TickMessage {
  type: 'tick';
  tick: number;
  commands: WireCommand[];
  drone: WireDroneControl;
  /**
   * Desync probe: a hash of the sender's world at an **already-simulated** tick
   * (never this message's `tick`, whose input hasn't been applied yet). The peer
   * compares it against its own hash for that tick; a mismatch means the two
   * simulations have parted and everything after it is fiction. Optional — sent
   * every `DESYNC_CHECK_EVERY` ticks rather than on every message.
   */
  check?: WorldCheck;
}

/** One "my world looked like this at tick N" probe — see `TickMessage.check`. */
export interface WorldCheck {
  tick: number;
  hash: number;
}

/** How often a peer attaches a `WorldCheck` (in ticks) — ~1s at 10Hz. */
export const DESYNC_CHECK_EVERY = 10;

export type ClientMessage = TickMessage;

// ---------------------------------------------------------------------------
// Relay → client
// ---------------------------------------------------------------------------

/** Host acknowledgement: the room is open and waiting for a guest. */
export interface CreatedMessage {
  type: 'created';
  roomCode: string;
}

/**
 * Both sockets present — begin simulating from this shared match setup. Everything
 * that shapes the world has to be here: the peers build it independently, so any
 * setting only one of them knows would desync them. `aiCount` bots join the two
 * humans in a free-for-all; both peers simulate them locally and identically, so
 * bot input never crosses the wire.
 */
export interface StartMessage {
  type: 'start';
  seed: number;
  mapSize: WireMapSize;
  aiCount: number;
}

/** The peer disconnected; the match ends (no reconnection support). */
export interface OpponentLeftMessage {
  type: 'opponentLeft';
}

export type ErrorCode = 'room-not-found' | 'room-full' | 'room-taken' | 'version-mismatch' | 'bad-message';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMessage = CreatedMessage | StartMessage | TickMessage | OpponentLeftMessage | ErrorMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;
