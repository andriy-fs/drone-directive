import { create } from 'zustand';
import { gameConfig } from '../config/gameConfig';
import { createDefaultSettings, type GameSettings, type SettingsPatch } from '../config/gameSettings';
import { Locale } from '../i18n/locale';
import type { Command } from '../types/commands';
import type { BuildOrder, ResourcePool, Vec2 } from '../types/entities';
import type { ChassisType, Owner, TaskType, WeaponType } from '../types/enums';

/** HUD-facing observer-drone status (projected from the ECS world). */
export interface DroneStatus {
  mode: 'flying' | 'possessing';
  /** Id of the robot the drone is controlling, or null when free-flying. */
  possessedRobotId: string | null;
  /** True while the drone is away so player auto-build is suppressed. */
  autoBuildSuppressed: boolean;
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

export interface GameState {
  status: GameStatus;
  bases: BaseSnapshot[];
  robots: RobotSnapshot[];
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
  /** Player-editable settings + their defaults (see config/gameSettings). */
  settings: GameSettings;
  /** Active UI language. */
  locale: Locale;
  setStatus: (status: GameStatus) => void;
  setBases: (bases: BaseSnapshot[]) => void;
  setRobots: (robots: RobotSnapshot[]) => void;
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
  setLocale: (locale: Locale) => void;
}

const initialState = {
  status: 'menu' as GameStatus,
  bases: [] as BaseSnapshot[],
  robots: [] as RobotSnapshot[],
  resources: {
    player: gameConfig.economy.startingResources,
    ai: gameConfig.economy.startingResources,
  } as ResourcePool,
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
    autoBuildSuppressed: false,
  } as DroneStatus,
  settings: createDefaultSettings(),
  locale: Locale.En,
};

export const useGameStore = create<GameState>((set, get) => ({
  ...initialState,
  setStatus: (status) => set({ status }),
  setBases: (bases) => set({ bases }),
  setRobots: (robots) => set({ robots }),
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
  setLocale: (locale) => set({ locale }),
}));

/** Non-reactive handle for the app bridge (outside React). */
export const gameStore = useGameStore;
