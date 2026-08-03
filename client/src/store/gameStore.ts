import { create } from 'zustand';
import type { ChatMessage, ChatSeat } from '@drone-directive/chat';
import { loadChatSound } from '../chat/chatStorage';
import { gameConfig } from '../config/gameConfig';
import { createDefaultSettings, type GameSettings, type SettingsPatch } from '../config/gameSettings';
import { Locale, resolveInitialLocale, saveLocale } from '../i18n/locale';
import type { Command } from '@drone-directive/types/commands';
import type { BuildOrder, ResourcePool, Vec2 } from '@drone-directive/types/entities';
import { Owner } from '@drone-directive/types/enums';
import type { ChassisType, MapSize, TaskType, WeaponType } from '@drone-directive/types/enums';

/** HUD-facing observer-drone status (projected from the ECS world). */
export interface DroneStatus {
  /** `down` = shot down, a replacement is being built (see `respawnProgress`). */
  mode: 'flying' | 'possessing' | 'down';
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
}

/** HUD-facing view of a base. */
export interface BaseSnapshot {
  id: string;
  owner: Owner;
  hp: number;
  maxHp: number;
  queueLength: number;
  buildProgress: number;
  /** Continuously auto-produced model, or null = off. */
  autoBuild: BuildOrder | null;
  /** Default program produced robots take when their build order doesn't set one. */
  defaultTask: TaskType | null;
  /** Where newly produced Idle/Guard robots gather, or null = no rally point. */
  rally: Vec2 | null;
}

/**
 * UI state + HUD snapshots. The game engine lives outside React; the app bridge
 * (GameApp) pushes throttled snapshots in and reads flags/commands out.
 */
export type GameStatus = 'menu' | 'playing' | 'won' | 'lost';

/**
 * Online lobby/connection status. `offline` = solo/menu; `connecting` = socket
 * opening; `hosting` = host created a room, waiting for a guest (shows the code);
 * `inMatch` = both connected, simulating; `ended` = the peer left / match over;
 * `error` = connection or join failure (`error` message set).
 */
export type OnlineStatus = 'offline' | 'connecting' | 'hosting' | 'inMatch' | 'ended' | 'error';

export interface OnlineState {
  status: OnlineStatus;
  /** The room code (host: generated; guest: the one they entered). */
  roomCode: string | null;
  /** Human-readable message for the `ended` / `error` states. */
  error: string | null;
}

/** One-shot online request the UI raises and the app bridge (GameApp) consumes. */
export type PendingOnline =
  { kind: 'host'; mapSize: MapSize; aiOpponents: number } | { kind: 'join'; roomCode: string } | { kind: 'leave' };

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

export interface GameState {
  status: GameStatus;
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
  /** Command queue: UI enqueues, the bridge forwards to the engine each tick. */
  commands: Command[];
  /** One-shot control flags the bridge observes (→ engine.startMatch / toMenu). */
  restartRequested: boolean;
  menuRequested: boolean;
  paused: boolean;
  /** Observer-drone flight direction (unit-ish vector); the bridge forwards it each step. */
  droneInput: Vec2;
  /** One-shot drone intents the bridge forwards then clears (land/take-off, fire/detonate). */
  dronePossessRequested: boolean;
  droneFireRequested: boolean;
  /** HUD-facing drone status pushed from snapshots. */
  droneStatus: DroneStatus;
  /** Build & program dialog visibility — opened by the HUD button or a double-click on your base. */
  buildDialogOpen: boolean;
  /** Player-editable settings + their defaults (see config/gameSettings). */
  settings: GameSettings;
  /** Active UI language. */
  locale: Locale;
  /** Which side this client plays/views (host = Player, guest = AI). Presentation only. */
  localSide: Owner;
  /** Online lobby/connection status (see OnlineState). */
  online: OnlineState;
  /** One-shot online request the bridge consumes (connect/leave). */
  pendingOnline: PendingOnline | null;
  /** Chat with the online opponent — event-driven, and outlives the match (see ChatState). */
  chat: ChatState;
  setStatus: (status: GameStatus) => void;
  setBases: (bases: BaseSnapshot[]) => void;
  setRobots: (robots: RobotSnapshot[]) => void;
  setSides: (sides: SideSnapshot[]) => void;
  setResources: (resources: ResourcePool) => void;
  selectRobots: (ids: string[]) => void;
  toggleRobot: (id: string) => void;
  /** Select the local side's base (or null to drop it); clears any robot selection. */
  selectBase: (id: string | null) => void;
  clearSelection: () => void;
  enqueueCommand: (command: Command) => void;
  drainCommands: () => Command[];
  /** Merge a shallow-per-group patch into settings (scales as settings grow). */
  updateSettings: (patch: SettingsPatch) => void;
  requestRestart: () => void;
  requestMenu: () => void;
  clearRequests: () => void;
  togglePause: () => void;
  setPaused: (value: boolean) => void;
  setDroneInput: (dir: Vec2) => void;
  requestDronePossess: () => void;
  requestDroneFire: () => void;
  clearDroneRequests: () => void;
  setDroneStatus: (status: DroneStatus) => void;
  setBuildDialogOpen: (open: boolean) => void;
  setLocale: (locale: Locale) => void;
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
  /** Bridge-only: merge a patch into the online connection state. */
  setOnline: (patch: Partial<OnlineState>) => void;
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
}

const initialState = {
  status: 'menu' as GameStatus,
  bases: [] as BaseSnapshot[],
  robots: [] as RobotSnapshot[],
  sides: [] as SideSnapshot[],
  resources: Object.fromEntries(
    Object.values(Owner).map((owner) => [owner, gameConfig.economy.startingResources]),
  ) as ResourcePool,
  selectedRobotIds: [] as string[],
  selectedBaseId: null as string | null,
  commands: [] as Command[],
  restartRequested: false,
  menuRequested: false,
  paused: false,
  droneInput: { x: 0, y: 0 } as Vec2,
  dronePossessRequested: false,
  droneFireRequested: false,
  droneStatus: {
    mode: 'flying',
    possessedRobotId: null,
    hp: gameConfig.drone.maxHp,
    maxHp: gameConfig.drone.maxHp,
    respawnProgress: 0,
  } as DroneStatus,
  buildDialogOpen: false,
  settings: createDefaultSettings(),
  locale: resolveInitialLocale(),
  localSide: Owner.Player as Owner,
  online: { status: 'offline', roomCode: null, error: null } as OnlineState,
  pendingOnline: null as PendingOnline | null,
  chat: {
    open: false,
    chatId: null,
    seat: null,
    roomCode: null,
    connected: false,
    peerOnline: false,
    messages: [],
    unread: 0,
    soundOn: loadChatSound(),
    error: null,
  } as ChatState,
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,
  setStatus: (status) => set({ status }),
  setBases: (bases) => set({ bases }),
  setRobots: (robots) => set({ robots }),
  setSides: (sides) => set({ sides }),
  setResources: (resources) => set({ resources }),
  // Robots and a base are mutually exclusive selections, and that is enforced
  // here rather than at the call sites: marquee, robot click, select-all and
  // control groups all write selection, and every one of them gets it for free.
  selectRobots: (ids) => set({ selectedRobotIds: ids, selectedBaseId: null }),
  toggleRobot: (id) =>
    set((s) => ({
      selectedRobotIds: s.selectedRobotIds.includes(id)
        ? s.selectedRobotIds.filter((x) => x !== id)
        : [...s.selectedRobotIds, id],
      selectedBaseId: null,
    })),
  selectBase: (id) => set({ selectedBaseId: id, selectedRobotIds: [] }),
  clearSelection: () => set({ selectedRobotIds: [], selectedBaseId: null }),
  enqueueCommand: (command) => set((s) => ({ commands: [...s.commands, command] })),
  drainCommands: () => {
    const { commands } = get();
    if (commands.length > 0) set({ commands: [] });
    return commands;
  },
  updateSettings: (patch) =>
    set((s) => ({
      settings: {
        match: { ...s.settings.match, ...patch.match },
        base: { ...s.settings.base, ...patch.base },
      },
    })),
  requestRestart: () => set({ restartRequested: true }),
  requestMenu: () => set({ menuRequested: true }),
  clearRequests: () => set({ restartRequested: false, menuRequested: false }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setPaused: (value) => set({ paused: value }),
  setDroneInput: (dir) => set({ droneInput: dir }),
  requestDronePossess: () => set({ dronePossessRequested: true }),
  requestDroneFire: () => set({ droneFireRequested: true }),
  clearDroneRequests: () => set({ dronePossessRequested: false, droneFireRequested: false }),
  setDroneStatus: (status) => set({ droneStatus: status }),
  setBuildDialogOpen: (open) => set({ buildDialogOpen: open }),
  setLocale: (locale) => {
    saveLocale(locale);
    set({ locale });
  },
  hostMatch: (mapSize, aiOpponents) =>
    set({
      localSide: Owner.Player,
      pendingOnline: { kind: 'host', mapSize, aiOpponents },
      online: { status: 'connecting', roomCode: null, error: null },
    }),
  joinMatch: (roomCode) => {
    const code = roomCode.toUpperCase();
    set({
      localSide: Owner.AI,
      pendingOnline: { kind: 'join', roomCode: code },
      online: { status: 'connecting', roomCode: code, error: null },
    });
  },
  leaveOnline: () =>
    set({
      localSide: Owner.Player,
      pendingOnline: { kind: 'leave' },
      online: { status: 'offline', roomCode: null, error: null },
    }),
  consumePendingOnline: () => {
    const { pendingOnline } = get();
    if (pendingOnline) set({ pendingOnline: null });
    return pendingOnline;
  },
  setOnline: (patch) => set((s) => ({ online: { ...s.online, ...patch } })),
  setChat: (patch) => set((s) => ({ chat: { ...s.chat, ...patch } })),
  mergeChatHistory: (entries) =>
    set((s) => {
      if (entries.length === 0) return {};
      // A reconnect asks for the gap, but a message can cross the request in
      // flight, so a replay may repeat something already on screen. `seq` is the
      // server's identity for a message, which makes the merge exact.
      const bySeq = new Map(s.chat.messages.map((m) => [m.seq, m]));
      for (const entry of entries) bySeq.set(entry.seq, entry);
      const messages = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
      return { chat: { ...s.chat, messages } };
    }),
  appendChatMessage: (entry) =>
    set((s) => {
      if (s.chat.messages.some((m) => m.seq === entry.seq)) return {};
      const fromPeer = entry.from !== s.chat.seat;
      return {
        chat: {
          ...s.chat,
          messages: [...s.chat.messages, entry],
          unread: fromPeer && !s.chat.open ? s.chat.unread + 1 : s.chat.unread,
        },
      };
    }),
  markChatRead: () => set((s) => (s.chat.unread === 0 ? {} : { chat: { ...s.chat, unread: 0 } })),
}));

/** Non-reactive handle for the app bridge (outside React). */
export const gameStore = useGameStore;
