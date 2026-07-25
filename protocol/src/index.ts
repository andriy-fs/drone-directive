/**
 * Wire protocol for online 2-player matches — the single source of truth for the
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
export const PROTOCOL_VERSION = 1;

/** Room codes: fixed length, drawn from an unambiguous alphabet (no 0/O/1/I). */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Connection contract. A WebSocket must target a specific room before it opens, so
 * the create/join intent travels as URL query params rather than as messages:
 *   host:  `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>`
 *   guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`
 */
export const QueryParam = {
  Room: 'room',
  Create: 'create',
  Version: 'v',
  MapSize: 'mapSize',
} as const;

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
}

export type ClientMessage = TickMessage;

// ---------------------------------------------------------------------------
// Relay → client
// ---------------------------------------------------------------------------

/** Host acknowledgement: the room is open and waiting for a guest. */
export interface CreatedMessage {
  type: 'created';
  roomCode: string;
}

/** Both sockets present — begin simulating from this shared seed + map size. */
export interface StartMessage {
  type: 'start';
  seed: number;
  mapSize: WireMapSize;
}

/** The peer disconnected; the match ends (no reconnection support). */
export interface OpponentLeftMessage {
  type: 'opponentLeft';
}

export type ErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'room-taken'
  | 'version-mismatch'
  | 'bad-message';

export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMessage =
  | CreatedMessage
  | StartMessage
  | TickMessage
  | OpponentLeftMessage
  | ErrorMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;
