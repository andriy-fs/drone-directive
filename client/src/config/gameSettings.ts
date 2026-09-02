import type { BuildOrder } from '@drone-directive/types/entities';
import { ChassisType, Difficulty, MapSize, MAX_SIDES, TaskType, WeaponType } from '@drone-directive/types/enums';

/**
 * Player-editable settings (distinct from `gameConfig`, which is fixed balance /
 * tuning). These are what the user sees and changes — before a match (main menu)
 * and, increasingly, during it. Grouped so the set can grow without churn: add a
 * field to a group, or a new group, and wire one control.
 *
 * `defaultGameSettings` / `createDefaultSettings()` are the single source of
 * truth for initial values; the store seeds from them.
 */

/** Match-wide options. */
export interface MatchSettings {
  difficulty: Difficulty;
  mapSize: MapSize;
  /**
   * How many bot-controlled sides join, on top of the human side(s). Free-for-all:
   * every side fights every other. Clamp with `maxAiOpponents(online)` — the map
   * seats at most `MAX_SIDES`, and a networked match already spends two of them.
   */
  aiOpponents: number;
  /** True only for networked matches — the second side is a remote human, and difficulty is forced to Normal. */
  online: boolean;
}

/** Largest bot count that still fits on the map, given how many humans are playing. */
export function maxAiOpponents(online: boolean): number {
  return MAX_SIDES - (online ? 2 : 1);
}

/** Clamps a requested bot count into what the map can actually seat. */
export function clampAiOpponents(count: number, online: boolean): number {
  return Math.max(0, Math.min(maxAiOpponents(online), Math.floor(count)));
}

/** Player base configuration applied at match start. */
export interface BaseSettings {
  /** Continuously auto-produced model, or null = off. */
  autoBuild: BuildOrder | null;
  /** Task every robot this base produces starts with (null = none/idle). */
  defaultProgram: TaskType | null;
}

export interface GameSettings {
  match: MatchSettings;
  base: BaseSettings;
}

/** A shallow-per-group patch for updating settings. */
export type SettingsPatch = {
  [K in keyof GameSettings]?: Partial<GameSettings[K]>;
};

/** Default model shown in the build/auto-build pickers before the user changes it. */
export const defaultBuildOrder: BuildOrder = {
  chassis: ChassisType.Tracks,
  weapon: WeaponType.Cannon,
};

/**
 * The settings one networked match is built from: the player's own, with the
 * room's numbers laid over them.
 *
 * A copy, deliberately. The room decides map size and bot count for both peers,
 * but those are the *host's* choices, not this player's, and writing them into
 * the store would make them the starting point of the next solo match. A 1v1
 * room seats no bots, so that used to leave `aiOpponents: 0` behind — and a solo
 * roster of one side is decided on its first tick (`buildRoster`).
 */
export function onlineMatchSettings(
  settings: GameSettings,
  room: { mapSize: MapSize; aiOpponents: number },
): GameSettings {
  return { ...settings, match: { ...settings.match, ...room, online: true } };
}

/** Fresh copy of the default settings (never share the object — it's mutated per game). */
export function createDefaultSettings(): GameSettings {
  return {
    match: { difficulty: Difficulty.Normal, mapSize: MapSize.Medium, aiOpponents: 1, online: false },
    // Auto-production is OFF by default: a side gets `production.maxRobots` slots
    // for the whole match, and they belong to the player's plan, not to a default
    // model queued before the first shot. The directive still stands by, so a base
    // switched on later starts building on Guard.
    base: { autoBuild: null, defaultProgram: TaskType.Guard },
  };
}
