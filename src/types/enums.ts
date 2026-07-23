/**
 * Enum-like unions. TS `enum` is disallowed by the project's `erasableSyntaxOnly`
 * tsconfig, so each "enum" is a frozen const map plus a same-named union type
 * derived from it. Import the const for values, the type for annotations.
 */

export const Owner = { Player: 'player', AI: 'ai', Neutral: 'neutral' } as const;
export type Owner = (typeof Owner)[keyof typeof Owner];

export const ChassisType = { Tracks: 'tracks', Wheels: 'wheels', Legs: 'legs' } as const;
export type ChassisType = (typeof ChassisType)[keyof typeof ChassisType];

export const WeaponType = {
  None: 'none',
  Cannon: 'cannon',
  Missiles: 'missiles',
  Bomb: 'bomb',
  Radar: 'radar',
  Ew: 'ew',
} as const;
export type WeaponType = (typeof WeaponType)[keyof typeof WeaponType];

export const TaskType = {
  Idle: 'idle',
  Guard: 'guard',
  AttackBase: 'attackBase',
  AttackRobots: 'attackRobots',
  Scout: 'scout',
  /** Focus-fire a specific ordered target (robot or base) — see `blackboard.attackTargetId`. */
  AttackTarget: 'attackTarget',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const RobotState = {
  Idle: 'idle',
  Moving: 'moving',
  Attacking: 'attacking',
  Guarding: 'guarding',
  Dead: 'dead',
} as const;
export type RobotState = (typeof RobotState)[keyof typeof RobotState];

export const Difficulty = { Easy: 'easy', Normal: 'normal', Hard: 'hard' } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const MapSize = { Small: 'small', Medium: 'medium', Large: 'large' } as const;
export type MapSize = (typeof MapSize)[keyof typeof MapSize];

/** Named auto-production sequences a base can cycle through — see `config/buildPresets.ts`. */
export const BuildPresetType = {
  Tracks: 'tracks',
  TracksWheels: 'tracksWheels',
  MixedSquad: 'mixedSquad',
  /** The AI's production series (every 10th unit is a base-rushing kamikaze). */
  AiAssault: 'aiAssault',
} as const;
export type BuildPresetType = (typeof BuildPresetType)[keyof typeof BuildPresetType];
