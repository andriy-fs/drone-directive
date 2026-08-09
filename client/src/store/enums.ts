/**
 * Enum-like values for the UI store, as frozen const maps plus a same-named
 * union — the project's standing alternative to a TS `enum` (the same shape as
 * `types/src/enums.ts` and `i18n/locale.ts`; import the const for values, the
 * type for annotations).
 *
 * They live apart from `types.ts` because they are the one half of the store's
 * vocabulary that exists at runtime: every one of them is read outside this
 * folder — by the HUD, the hotkeys and the app bridge — where a bare
 * `status === 'playing'` would say nothing about where the other values live, or
 * that there are only three of them.
 */

/** What the local side's observer drone is doing. */
export const DroneMode = {
  /** Free flight — the drone is its own eye. */
  Flying: 'flying',
  /** Landed on an idle robot and steering it. */
  Possessing: 'possessing',
  /** Shot down; a replacement is being built (see `respawnProgress`). */
  Down: 'down',
} as const;
export type DroneMode = (typeof DroneMode)[keyof typeof DroneMode];

/** Which screen the game is on. Driven by engine scene events via the bridge. */
export const GameStatus = { Menu: 'menu', Playing: 'playing', Won: 'won', Lost: 'lost' } as const;
export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

/**
 * Why an online match is standing still, when it is. Lockstep freezes both worlds
 * the moment one side's input for the current tick is missing, so a stall is
 * normal and recoverable — but indistinguishable from a crash unless the HUD says
 * which it is.
 */
export const OnlineLink = {
  Ok: 'ok',
  /** The peer's input for this tick is late. */
  Stalled: 'stalled',
  /** Our own socket dropped and the session is reclaiming its seat. */
  Reconnecting: 'reconnecting',
} as const;
export type OnlineLink = (typeof OnlineLink)[keyof typeof OnlineLink];

/** The phases of {@link OnlineState} — its tag, and the whole set in one place. */
export const OnlineStatus = {
  /** Solo / menu: there is no session at all. */
  Offline: 'offline',
  /** The socket is opening. */
  Connecting: 'connecting',
  /** The host holds a room and is showing its code, waiting for a guest. */
  Hosting: 'hosting',
  /** Both peers are in and the simulation is running. */
  InMatch: 'inMatch',
  /** The session ran its course. */
  Ended: 'ended',
  /** The session failed. */
  Error: 'error',
} as const;
export type OnlineStatus = (typeof OnlineStatus)[keyof typeof OnlineStatus];

/** The kinds of {@link PendingOnline} — what the lobby can ask the bridge to do. */
export const OnlineRequest = { Host: 'host', Join: 'join', Leave: 'leave' } as const;
export type OnlineRequest = (typeof OnlineRequest)[keyof typeof OnlineRequest];
