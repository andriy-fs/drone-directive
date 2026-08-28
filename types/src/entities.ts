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
 * The observer drone's input for one tick: two continuous axes plus two one-shot
 * pulses. Lives here rather than in the engine because it crosses the network —
 * both the engine and `@drone-directive/net` need it, and neither may depend on
 * the other.
 */
export interface DroneControl {
  /**
   * The stick, `{0,0}` = centred. **What the two components mean depends on what
   * the drone is doing**, and the receiver decides that from the world, not from
   * anything on the wire:
   *
   * - flying free, it is a world direction — a unit vector, or zero;
   * - riding a hull, it is that machine's own controls — `y` is throttle along its
   *   heading (negative is forward, matching screen axes) and `x` is a yaw rate.
   *
   * Either way each component is within `[-1, 1]`, which is all the wire promises
   * and all the validator checks (`net/src/wire/validation`). The split itself is
   * argued at `drivePossessed` in `client/src/engine/systems/drone.ts`.
   */
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
