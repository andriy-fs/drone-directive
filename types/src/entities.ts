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
 * The observer drone's input for one tick: a continuous flight direction plus two
 * one-shot pulses. Lives here rather than in the engine because it crosses the
 * network — both the engine and `@drone-directive/net` need it, and neither may
 * depend on the other.
 */
export interface DroneControl {
  /** Continuous flight/steer direction; `{0,0}` = hold position. */
  dir: Vec2;
  /** One-shot: land on / take off from a robot this tick. */
  possessPulse: boolean;
  /** One-shot: fire / detonate the possessed robot this tick. */
  firePulse: boolean;
}

/**
 * NOTE: live entities (robots, bases, projectiles, explosions) are ECS entities
 * with optional components — see `client/src/engine/ecs/entity.ts`. This package
 * only holds value types shared across layers and workspaces.
 */
