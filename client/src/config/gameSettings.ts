import type { BuildOrder } from '../types/entities';
import { ChassisType, Difficulty, MapSize, TaskType, WeaponType } from '../types/enums';

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

/** Fresh copy of the default settings (never share the object — it's mutated per game). */
export function createDefaultSettings(): GameSettings {
  return {
    match: { difficulty: Difficulty.Normal, mapSize: MapSize.Medium },
    // Auto-produce tracked robots by default, set to Guard.
    base: { autoBuild: { ...defaultBuildOrder }, defaultProgram: TaskType.Guard },
  };
}
