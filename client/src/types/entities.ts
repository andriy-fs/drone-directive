import type { ChassisType, Owner, TaskType, WeaponType } from './enums';

/** A point in continuous world space (pixels). */
export interface Vec2 {
  x: number;
  y: number;
}

/** Per-side resource balances, keyed by owner (every side has an entry). */
export type ResourcePool = Record<Owner, number>;

/**
 * A queued robot to be produced by a base. `task` is the program to assign on
 * spawn: omitted (`undefined`) means "unspecified — fall back to the base's
 * `production.defaultTask`"; `null` means "explicitly no program" (stays
 * Idle) regardless of the base's default; a `TaskType` overrides it outright.
 */
export interface BuildOrder {
  chassis: ChassisType;
  weapon: WeaponType;
  task?: TaskType | null;
}

/**
 * NOTE: live entities (robots, bases, projectiles, explosions) are ECS entities
 * with optional components — see `src/engine/ecs/entity.ts`. This file only holds
 * shared value types used across layers.
 */
