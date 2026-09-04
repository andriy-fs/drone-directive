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

/**
 * Which screen the game is on. Driven by engine scene events via the bridge.
 *
 * `Loading` is a screen like `Menu`, not a phase running alongside one — that is
 * why it belongs here rather than in a field of its own the way `OutcomePhase`
 * does. The two are mutually exclusive with `Playing`: a world is either being
 * built or being played, never both. Everything gated on `=== Playing` (hotkeys,
 * pointer, zoom, selection) therefore stays shut for free while the loader is up,
 * which is exactly what a screen with no battlefield under it wants.
 */
export const GameStatus = {
  Menu: 'menu',
  /** A match has been asked for; the world (and its sprites) are being built. */
  Loading: 'loading',
  Playing: 'playing',
  Won: 'won',
  Lost: 'lost',
} as const;
export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

/**
 * How far the end-of-match transition has got — and deliberately *not* part of
 * `GameStatus`, for a reason that is worth stating precisely, since `Loading`
 * *is* part of it: this phase runs **alongside** a status rather than instead of
 * one. `Won` is set the instant the last base falls and stays set through the
 * hold, the veil and the reveal, so both facts are true at once and need two
 * fields. A state that merely replaces another one belongs in the enum. Only
 * `GameApp` writes this (`.docs/tasks/outcome-transition.md`).
 */
export const OutcomePhase = {
  /** A match is running, or none is. */
  None: 'none',
  /** The blast plays out on the live field; nothing on screen has changed yet. */
  Hold: 'hold',
  /** The veil fades the world — HUD included — down to black. */
  Veil: 'veil',
  /** Out of the black: the outcome art, then the card. */
  Reveal: 'reveal',
} as const;
export type OutcomePhase = (typeof OutcomePhase)[keyof typeof OutcomePhase];

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

/**
 * How stale this bundle is — one field for two signals that mean the same thing
 * at different severities (`config/version.ts`, and the relay's own rejection).
 *
 * It only ever escalates during a session: staleness is a fact about the running
 * bundle, not about the lobby, so nothing that resets `online` may walk it back.
 */
export const ClientVersion = {
  /** Nothing says otherwise — the state every client starts in. */
  Current: 'current',
  /** A newer build is deployed. Playing is fine; the page just wants reloading. */
  UpdateAvailable: 'update-available',
  /** The wire protocol moved on. Online play cannot work until the client does. */
  OnlineBlocked: 'online-blocked',
} as const;
export type ClientVersion = (typeof ClientVersion)[keyof typeof ClientVersion];
