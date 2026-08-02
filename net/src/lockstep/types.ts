import type { Command } from '@drone-directive/types/commands';
import type { DroneControl } from '@drone-directive/types/entities';
import type { MapSize } from '@drone-directive/types/enums';
import type { ErrorCode } from '../wire/codec';
import type { CommandLimits } from '../wire/validation';

/** The transport's vocabulary: what a tick carries, what the host injects, what it calls back. */

/** One tick's worth of a single side's input (buffered locally, sent over the wire). */
export interface TickInput {
  commands: Command[];
  drone: DroneControl;
}

/** What the host application has to tell the transport about its own world. */
export interface LockstepConfig {
  /** WebSocket URL of the relay Worker. */
  relayUrl: string;
  /**
   * The validation limits for the match in progress. Called on every screening
   * rather than read once: the map is resized between matches, so a captured
   * bound would reject legal orders as soon as the players changed map size.
   */
  limits: () => CommandLimits;
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
