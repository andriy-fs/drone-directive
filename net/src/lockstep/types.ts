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
  /**
   * "Flip the shared pause at this tick" — a pulse, not the pause state. Either
   * side may raise it, both sides apply both pulses, so the two worlds agree on
   * whether they are running without anyone owning the pause. The host
   * application keeps the resulting flag; this package only carries the bit.
   */
  pauseToggle: boolean;
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
  /**
   * Both sockets present — start simulating from this seed + map size.
   *
   * `chatId` is opaque to this package: the relay issues it here because `start`
   * is the one moment both peers are told the same thing at the same instant, and
   * the host application takes it from there (see `@drone-directive/chat`).
   */
  onStart?: (seed: number, mapSize: MapSize, aiCount: number, chatId: string) => void;
  /** The peer disconnected; the match is over. */
  onOpponentLeft?: () => void;
  onError?: (code: ErrorCode, message: string) => void;
  /**
   * The session has given up: the socket closed and either it cannot be resumed
   * (no match in progress) or every attempt inside the grace window failed. The
   * match is over — unlike `onLinkDown`, this one does not come back.
   */
  onClose?: () => void;
  /**
   * The socket dropped mid-match and the session is trying to reclaim its seat.
   * Nothing is lost yet: neither peer can advance without the other's input, so
   * both worlds are simply standing still. Purely an invitation to say so on
   * screen.
   */
  onLinkDown?: () => void;
  /** The seat was reclaimed and the missed frames replayed; the match resumes. */
  onLinkUp?: () => void;
  /**
   * The peer's world hash for `tick` disagreed with ours: the simulations have
   * parted. Everything either client shows after this point is unreliable.
   */
  onDesync?: (tick: number, mine: number, theirs: number) => void;
}
