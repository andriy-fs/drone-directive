import { create } from 'zustand';
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
  setStatus: (status: GameStatus) => void;
  setBases: (bases: BaseSnapshot[]) => void;
  setRobots: (robots: RobotSnapshot[]) => void;
  setSides: (sides: SideSnapshot[]) => void;
  setResources: (resources: ResourcePool) => void;
  selectRobots: (ids: string[]) => void;
  toggleRobot: (id: string) => void;
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
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,
  setStatus: (status) => set({ status }),
  setBases: (bases) => set({ bases }),
  setRobots: (robots) => set({ robots }),
  setSides: (sides) => set({ sides }),
  setResources: (resources) => set({ resources }),
  selectRobots: (ids) => set({ selectedRobotIds: ids }),
  toggleRobot: (id) =>
    set((s) => ({
      selectedRobotIds: s.selectedRobotIds.includes(id)
        ? s.selectedRobotIds.filter((x) => x !== id)
        : [...s.selectedRobotIds, id],
    })),
  clearSelection: () => set({ selectedRobotIds: [] }),
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
}));

/** Non-reactive handle for the app bridge (outside React). */
export const gameStore = useGameStore;
