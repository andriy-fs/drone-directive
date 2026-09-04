/**
 * The shapes the UI store holds: the HUD-facing snapshot DTOs the app bridge
 * projects out of the ECS world, the online/chat slices, and `GameState` itself —
 * the store's whole contract, fields and actions together.
 *
 * Split out of `gameStore.ts` so that file is only the store: what the state
 * *is* is read by half the HUD, while how it is *built* concerns nobody but the
 * store. The enum-like values these refer to live in `./enums` — they are the
 * half of this vocabulary that survives to runtime.
 *
 * Snapshots are flat projections of ECS entities, never the entities themselves:
 * React must not hold a reference into the simulation (see `.docs/zustand.md`).
 */
import type { ChatMessage, ChatSeat } from '@drone-directive/chat';
import type { GameSettings, SettingsPatch } from '../config/gameSettings';
import type { Locale } from '../i18n/locale';
import type { RadioKey, RadioParams } from '../radio/types';
import type { Theme } from '../theme/theme';
import type { Command } from '@drone-directive/types/commands';
import type { BuildOrder, ResourcePool, Vec2 } from '@drone-directive/types/entities';
import type { ChassisType, FormationType, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import type {
  ClientVersion,
  DroneMode,
  GameStatus,
  OnlineLink,
  OnlineRequest,
  OnlineStatus,
  OutcomePhase,
} from './enums';

/** HUD-facing observer-drone status (projected from the ECS world). */
export interface DroneStatus {
  mode: DroneMode;
  /**
   * The drone's entity id, or null while it is down. The HUD needs it to *select*
   * the drone (`selectDrone`), which is the one thing about the eye the panel
   * could not do before: everything else here is a readout.
   */
  id: string | null;
  /** Id of the robot the drone is controlling, or null when free-flying. */
  possessedRobotId: string | null;
  hp: number;
  maxHp: number;
  /** Readiness of the replacement drone, 0..1. Only meaningful while `down`. */
  respawnProgress: number;
}

/** HUD-facing view of a robot (projected from the ECS world by the app bridge). */
export interface RobotSnapshot {
  id: string;
  owner: Owner;
  chassis: ChassisType;
  weapon: WeaponType;
  task: TaskType;
  hp: number;
  maxHp: number;
  /** The shape this robot marches in, or null = none. Drives the formation tiles' highlight. */
  formation: FormationType | null;
}

/** HUD-facing view of a base's one-shot energy dome (see `engine/systems/shield.ts`). */
export interface BaseShieldSnapshot {
  /** The dome is up right now — flips what the readout and the tile mean. */
  active: boolean;
  /** Dome strength and its cap; only meaningful while `active`. */
  hp: number;
  maxHp: number;
  /** Seconds of dome left; 0 when it is not up. */
  secondsLeft: number;
  /** The single charge is gone — standing now, or already ended. */
  spent: boolean;
  /**
   * A known enemy robot is inside the base's detection radius: the button's
   * gate. Always false for a base that isn't the local side's — it is derived
   * from that side's private intel, and the HUD has no business holding a
   * rival's.
   */
  threatNear: boolean;
}

/** HUD-facing view of a base. */
export interface BaseSnapshot {
  id: string;
  owner: Owner;
  hp: number;
  maxHp: number;
  /**
   * What the factory has been told to build, in order — the head is what it is
   * working on now.
   *
   * The orders themselves rather than a count, because the build dialog lists them
   * and lets the player take one back off. Rebuilt with the snapshot like every
   * other field here; a queue is a dozen small objects at most (`maxRobots`).
   */
  queue: BuildOrder[];
  buildProgress: number;
  /**
   * The queue has something in it but the factory has not started, because the
   * side cannot yet pay for the order in front (`Production.funded`).
   *
   * Here because the feature that made queueing free also made it possible for a
   * queue to sit at zero progress indefinitely, and a progress bar that never
   * moves with no explanation reads as a broken game rather than as an empty
   * wallet.
   */
  waitingForResources: boolean;
  /** Continuously auto-produced model, or null = off. */
  autoBuild: BuildOrder | null;
  /** Default program produced robots take when their build order doesn't set one. */
  defaultTask: TaskType | null;
  /** Where newly produced Idle/Guard robots gather, or null = no rally point. */
  rally: Vec2 | null;
  /** The one-shot energy dome: whether it stands, how much of it is left, and whether it can still be raised. */
  shield: BaseShieldSnapshot;
}

/**
 * Where this client is in the online lifecycle — a discriminated union rather
 * than a status string beside three independent fields, because only a handful
 * of the combinations those four fields could spell out are real ones. A room
 * code with no room, a transport health outside a match, an error message on a
 * lobby that has not failed: all of them used to be expressible, and were kept
 * out by convention (`setOnline` patches that remembered to reset the fields the
 * new status has no use for) rather than by the type.
 *
 * Each variant carries exactly what that state has, so a consumer that reads
 * `link` or `error` has already proved the state it belongs to — and the
 * transitions below are the only way to move between them.
 */
export type OnlineState =
  | { status: typeof OnlineStatus.Offline }
  /** The host has no code yet; the guest carries the one they typed. */
  | { status: typeof OnlineStatus.Connecting; roomCode: string | null }
  | { status: typeof OnlineStatus.Hosting; roomCode: string }
  /** `link` is the transport's health — see {@link OnlineLink}. */
  | { status: typeof OnlineStatus.InMatch; link: OnlineLink }
  /** However it ended, there is something to report. */
  | { status: typeof OnlineStatus.Ended | typeof OnlineStatus.Error; error: string };

/** One-shot online request the UI raises and the app bridge (GameApp) consumes. */
export type PendingOnline =
  | { kind: typeof OnlineRequest.Host; mapSize: MapSize; aiOpponents: number }
  | { kind: typeof OnlineRequest.Join; roomCode: string }
  | { kind: typeof OnlineRequest.Leave };

/**
 * Chat with the online opponent.
 *
 * **The store's first slice with no engine snapshot behind it.** Every other
 * field here is projected from the ECS world on a tick; this one is event-driven
 * — the chat bridge appends to it as frames arrive — and it must never be rebuilt
 * from a snapshot, because the engine has never heard of it. It also outlives the
 * match on purpose: `endOnline`/`leaveOnlineIfAny` reset `online`, not this.
 */
export interface ChatState {
  /** Panel expanded? Collapsed is a button with an unread badge. */
  open: boolean;
  /** The chat this client is attached to, or null when there is none to attach to. */
  chatId: string | null;
  /** Which seat this client holds — what makes a message "You" rather than "Opponent". */
  seat: ChatSeat | null;
  /** The room code the match was played in, for telling two conversations apart. */
  roomCode: string | null;
  /** Socket state. False while reconnecting — the log stays on screen regardless. */
  connected: boolean;
  /** Is the opponent attached right now (the presence dot)? */
  peerOnline: boolean;
  /** The log, oldest first, exactly as the server numbered it. */
  messages: ChatMessage[];
  /** Messages from the opponent since the panel was last read. */
  unread: number;
  /**
   * Does an arriving message make a sound? Separate from the game's own mute
   * (`sfx.setMuted`, the HUD speaker), because the two answer different
   * questions: one is "I don't want game audio", the other is "don't ping me".
   * The global mute still wins — it silences everything, this one included.
   */
  soundOn: boolean;
  error: string | null;
}

/** HUD-facing view of one side in the match (projected from the engine roster). */
export interface SideSnapshot {
  owner: Owner;
  /** True while this side still holds a base. */
  alive: boolean;
  /** True for bot-controlled sides — the HUD labels them differently. */
  bot: boolean;
}

/**
 * What the loading screen has to announce, composed by the bridge the moment a
 * match is asked for.
 *
 * Not derived in the UI from `settings.match`, and not read off `sides` either,
 * because neither is true at the moment the loader goes up. `settings` is the
 * *local* player's, so an online guest would announce its own map size and bot
 * count rather than the host's, which are what the handshake actually decided;
 * and `sides` is a projection of a world that does not exist yet — during the
 * sprite wait it still holds the previous match's roster. The bridge is the one
 * place that knows the real answer on both routes into a match, so it says it
 * once, here.
 */
export interface MatchBrief {
  mapSize: MapSize;
  online: boolean;
  /** Every side that will be seated, in roster order (`buildRoster`). */
  sides: { owner: Owner; bot: boolean }[];
}

/**
 * What the store *holds* — the half `initialState` has to fill in and the half
 * every selector reads. Split from the actions so the starting values can be
 * annotated with it (see `./initialState`): as a bare object literal they needed
 * a cast per field to keep TypeScript from widening them, and a missing field
 * was only caught later, at the `create()` call, as one error about the whole
 * object rather than one about the field.
 */
export interface GameStateFields {
  status: GameStatus;
  /** How far the end-of-match reveal has got. Bridge-only; see `OutcomePhase`. */
  outcomePhase: OutcomePhase;
  /**
   * What the loading screen announces, or null outside `GameStatus.Loading`.
   * Bridge-only, and cleared with the loader so nothing can render a stale
   * briefing over the next match.
   */
  matchBrief: MatchBrief | null;
  bases: BaseSnapshot[];
  robots: RobotSnapshot[];
  /** Who's playing, in seating order — drives the per-side HUD rows. */
  sides: SideSnapshot[];
  resources: ResourcePool;
  /** UI selection (entity ids); the renderer highlights these. */
  selectedRobotIds: string[];
  /**
   * The selected base, or null. Mutually exclusive with `selectedRobotIds`:
   * with a base selected, right-click sets its rally point instead of moving.
   */
  selectedBaseId: string | null;
  /**
   * The selected observer drone, or null. The third mutually exclusive slot: it
   * is one unique unit per side, so it gets a slot of its own rather than a place
   * in `selectedRobotIds`, where the marquee, select-all, formations, directives
   * and attack orders would all have to learn to leave it out again.
   */
  selectedDroneId: string | null;
  /** Command queue: UI enqueues, the bridge forwards to the engine each tick. */
  commands: Command[];
  /** One-shot control flags the bridge observes (→ engine.startMatch / toMenu). */
  restartRequested: boolean;
  menuRequested: boolean;
  paused: boolean;
  /** One-shot "flip the shared pause" the bridge puts on the wire (online only). */
  pauseTogglePending: boolean;
  /**
   * The WASD/arrow vector, and what it means depends on one thing only: whether a
   * hull is being ridden. Free — it pans the camera, and never leaves this client.
   * Riding — it is that machine's own throttle and yaw, and the bridge forwards it
   * as `DroneControl.dir`.
   *
   * **It no longer flies the observer drone.** The eye is flown by `MoveDrone`
   * orders (select it, right-click), which is the one control scheme a keyboard is
   * not required for — and the reason this vector has a single meaning per mode
   * instead of being switched by a camera setting.
   */
  stickInput: Vec2;
  /** One-shot drone intents the bridge forwards then clears (land/take-off, fire/detonate). */
  dronePossessRequested: boolean;
  droneFireRequested: boolean;
  /** HUD-facing drone status pushed from snapshots. */
  droneStatus: DroneStatus;
  /**
   * "Put the camera on my drone" — a one-shot request the bridge consumes on its
   * next frame, not a mode. Client-local by design: the camera feeds nothing in
   * the simulation, so this never becomes a `Command` and never goes on the wire.
   *
   * A jump rather than a follow, and that is the whole point: the drone can be
   * anywhere on an 80x80 map and this is how a player gets back to it, but nothing
   * about it changes what any other control does afterwards.
   */
  showDroneRequested: boolean;
  /**
   * A replacement drone has rolled out and the player has not looked at it yet:
   * a counter identifying the current notice, or 0 for none. Raised by the
   * bridge on the local side's drone respawn, cleared when the view is synced.
   *
   * A counter rather than a flag so the toast can tell "this notice" from "the
   * one before it" and time itself out without writing state back — two rebuilds
   * in one match are otherwise indistinguishable.
   */
  droneReadyNotice: number;
  /** Build & program dialog visibility — opened by the HUD button or a double-click on your base. */
  buildDialogOpen: boolean;
  /** Player-editable settings + their defaults (see config/gameSettings). */
  settings: GameSettings;
  /** Active UI language. */
  locale: Locale;
  /** Whether this bundle has fallen behind the deploy (see ClientVersion). */
  clientVersion: ClientVersion;
  /** Active UI colour/type scheme — written onto `<html data-theme>` (see theme/). */
  theme: Theme;
  /** Which side this client plays/views (host = Player, guest = AI). Presentation only. */
  localSide: Owner;
  /** Online lobby/connection status (see OnlineState). */
  online: OnlineState;
  /** One-shot online request the bridge consumes (connect/leave). */
  pendingOnline: PendingOnline | null;
  /** Chat with the online opponent — event-driven, and outlives the match (see ChatState). */
  chat: ChatState;
  /** The radio feed over the scene — event-driven like `chat` (see RadioLine). */
  radio: RadioLine[];
}

/**
 * One line in the radio feed.
 *
 * The second slice with no engine snapshot behind it, after `chat`, and it breaks
 * the same rule for the same reason: the director appends to it as bus events
 * arrive, and rebuilding it from a tick would erase everything already said.
 *
 * Stores a phrase *key and seed* rather than the rendered text. Resolving late is
 * what lets a line already hanging on screen switch language with the rest of the
 * UI instead of freezing in whichever one it was born in — and the seed stays
 * meaningful across locales that have different numbers of variants.
 */
export interface RadioLine {
  /** Monotonic within a match; the React key, and the feed's ordering. */
  id: number;
  key: RadioKey;
  /** Picks the variant: `variants[seed % variants.length]`. */
  seed: number;
  params: RadioParams;
  /** Alert lines are read in red — the local player's losses, not the enemy's. */
  alert: boolean;
  /** `performance.now()` when it was said. Drives expiry, not display. */
  at: number;
  /** Milliseconds since the match started — the `[mm:ss]` prefix. */
  elapsedMs: number;
}

/**
 * What the store *does*. UI intents become commands or one-shot flags the bridge
 * observes; everything marked bridge-only is written by `GameApp` and read by the
 * HUD, never the other way round.
 */
export interface GameActions {
  setStatus: (status: GameStatus) => void;
  setOutcomePhase: (phase: OutcomePhase) => void;
  /**
   * Raise the loading screen with what it should announce (bridge-only). There is
   * no matching clear: `setStatus` drops the briefing on the way out of
   * `Loading`, so no caller can strand one over the next match.
   */
  beginLoading: (brief: MatchBrief) => void;
  setBases: (bases: BaseSnapshot[]) => void;
  setRobots: (robots: RobotSnapshot[]) => void;
  setSides: (sides: SideSnapshot[]) => void;
  setResources: (resources: ResourcePool) => void;
  selectRobots: (ids: string[]) => void;
  toggleRobot: (id: string) => void;
  /** Select the local side's base (or null to drop it); clears any robot selection. */
  selectBase: (id: string | null) => void;
  /** Select the local side's observer drone (or null to drop it); clears the other two. */
  selectDrone: (id: string | null) => void;
  clearSelection: () => void;
  enqueueCommand: (command: Command) => void;
  drainCommands: () => Command[];
  /** Merge a shallow-per-group patch into settings (scales as settings grow). */
  updateSettings: (patch: SettingsPatch) => void;
  requestRestart: () => void;
  requestMenu: () => void;
  clearRequests: () => void;
  /**
   * Stop/resume the world. Solo it flips `paused` outright; in a networked match
   * it can only *ask* — the pause has to happen on the same tick in both
   * simulations, so it raises `pauseTogglePending` for the bridge to put on the
   * wire, and `paused` follows once the tick both peers agreed on comes round.
   */
  togglePause: () => void;
  setPaused: (value: boolean) => void;
  /** Bridge-only: take and clear the pending pause request. */
  consumePauseToggle: () => boolean;
  setStickInput: (dir: Vec2) => void;
  requestDronePossess: () => void;
  requestDroneFire: () => void;
  clearDroneRequests: () => void;
  setDroneStatus: (status: DroneStatus) => void;
  /** Ask the camera to jump to the local side's drone; also answers the "it is up again" notice. */
  requestShowDrone: () => void;
  /** Bridge-side: take the pending jump request, if any. */
  consumeShowDrone: () => boolean;
  /** Drop the "new drone ready" notice (looked at, dismissed, or timed out). */
  clearDroneReadyNotice: () => void;
  /** Bridge-only: raise the "new drone ready" notice on a local respawn. */
  noteDroneReady: () => void;
  setBuildDialogOpen: (open: boolean) => void;
  setLocale: (locale: Locale) => void;
  /**
   * Report what the update check (or the relay) found. **Escalates only** — a
   * later manifest fetch cannot talk a protocol block back down, and leaving the
   * lobby does not clear one.
   */
  reportClientVersion: (version: ClientVersion) => void;
  /** Switch the UI scheme. Unlike the language there is nothing to load first. */
  setTheme: (theme: Theme) => void;
  /**
   * Host a room (bridge generates the code, echoes it back). The host picks the
   * map and how many bots join both humans — the guest is told at match start.
   */
  hostMatch: (mapSize: MapSize, aiOpponents: number) => void;
  /** Join an existing room by code. */
  joinMatch: (roomCode: string) => void;
  /** Leave the lobby / online match and return to solo menu. */
  leaveOnline: () => void;
  /** Bridge-only: take and clear the pending online request. */
  consumePendingOnline: () => PendingOnline | null;
  /**
   * The online lifecycle's transitions — the only way `online` ever changes, and
   * all bridge-only (`GameApp` owns the session; the store just mirrors where it
   * is). Each one *replaces* the state rather than patching it, which is what
   * makes the union's promise hold: nothing from the state being left behind can
   * survive into the next one.
   */
  /** The relay created the room: show its code and wait for a guest. */
  setOnlineHosting: (roomCode: string) => void;
  /** Both peers are in — the match is running. */
  setOnlineInMatch: () => void;
  /** Transport health. Ignored outside a match, where there is no link to have one. */
  setOnlineLink: (link: OnlineLink) => void;
  /** The session is over — `isError` tells a failure from an ordinary end. */
  setOnlineFinished: (error: string, isError: boolean) => void;
  /** Back to no session at all. */
  setOnlineOffline: () => void;
  /**
   * Chat setters, all bridge-only (`client/src/chat/chatBridge.ts`) — the UI goes
   * through the bridge rather than here, because opening a panel also has to open
   * a socket and the store must not know what a socket is.
   */
  setChat: (patch: Partial<ChatState>) => void;
  /** Replay from the server: merge by `seq`, since it may overlap what is on screen. */
  mergeChatHistory: (entries: ChatMessage[]) => void;
  /** One new message; counts as unread when it is the opponent's and the panel is shut. */
  appendChatMessage: (entry: ChatMessage) => void;
  /** The player is looking at the log — clear the badge. */
  markChatRead: () => void;
  /**
   * Radio setters, all bridge-only (`client/src/pixi/radio/radioDirector.ts`).
   * The UI only ever reads the feed and prunes it — nothing in the HUD can make
   * a unit say something.
   */
  pushRadioLine: (line: RadioLine) => void;
  /** Drop lines older than `radioConfig.lineTtlMs`; a no-op when none have expired. */
  pruneRadio: (now: number) => void;
  /** New match, empty feed. */
  clearRadio: () => void;
}

/** The whole store: what it holds and what it does. */
export type GameState = GameStateFields & GameActions;
