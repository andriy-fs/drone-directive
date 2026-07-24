import type { BuildOrder } from '../types/entities';
import { BuildPresetType, ChassisType, TaskType, WeaponType } from '../types/enums';

/**
 * Named auto-production sequences — the base cycles through `sequence`
 * (wrapping back to the start), producing one order at a time. A single
 * chassis is just a length-1 sequence. Extend the roster by adding a key here;
 * the UI picker lists whatever's in this registry.
 *
 * A step's `task` is left unset on the plain chassis-mix presets, so produced
 * robots take the base's chosen program (the "Program" picker / pre-game default
 * → `production.defaultTask`). A step only sets `task` when the preset means to
 * *override* the program for that specific unit (see `MixedSquad` / `AiAssault`).
 *
 * Player presets are currently AI-facing plumbing (no player UI selects them);
 * `AiAssault` is the AI's actual production series — see `systems/ai.ts`.
 */
export interface BuildPreset {
  id: BuildPresetType;
  label: string;
  sequence: BuildOrder[];
}

export const buildPresets: Record<BuildPresetType, BuildPreset> = {
  [BuildPresetType.Tracks]: {
    id: BuildPresetType.Tracks,
    label: 'Tracks',
    sequence: [{ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon }],
  },

  [BuildPresetType.TracksWheels]: {
    id: BuildPresetType.TracksWheels,
    label: '1 Tracks : 2 Wheels',
    sequence: [
      { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles },
    ],
  },

  // Showcase of per-step program overrides: each unit gets its own role.
  [BuildPresetType.MixedSquad]: {
    id: BuildPresetType.MixedSquad,
    label: 'Mixed Squad',
    sequence: [
      { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon, task: TaskType.Guard },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles, task: TaskType.Scout },
      { chassis: ChassisType.Legs, weapon: WeaponType.Cannon, task: TaskType.AttackBase },
    ],
  },

  /**
   * The AI's production series. Steps 1–9 are a durable/ranged combat mix with
   * no forced program (they're staged into attack groups by `systems/ai.ts`);
   * the 10th is a tracked kamikaze bomb. It's left without a `task` override
   * (unlike the old fixed base-rush) so it spawns Idle and `systems/ai.ts`'s
   * `assignKamikaze` picks its target once it exists — a fat cluster of known
   * enemy robots, or the base if nothing juicier is around.
   */
  [BuildPresetType.AiAssault]: {
    id: BuildPresetType.AiAssault,
    label: 'AI Assault',
    sequence: [
      { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles },
      { chassis: ChassisType.Legs, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Tracks, weapon: WeaponType.Missiles },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles },
      { chassis: ChassisType.Legs, weapon: WeaponType.Missiles },
      { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
      { chassis: ChassisType.Tracks, weapon: WeaponType.Bomb },
    ],
  },
};

/** The build preset for an id (falls back to Tracks for safety). */
export function getBuildPreset(id: BuildPresetType): BuildPreset {
  return buildPresets[id] ?? buildPresets[BuildPresetType.Tracks];
}
