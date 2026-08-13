import type { With } from 'miniplex';
import {
  BASE_KEYS,
  DRONE_KEYS,
  MUNITION_KEYS,
  PROJECTILE_KEYS,
  ROBOT_KEYS,
  type BaseEntity,
  type DroneEntity,
  type MunitionEntity,
  type Positioned,
  type ProjectileEntity,
  type RobotEntity,
} from './archetypes';
import type { Entity } from './entity';

/**
 * Narrowing for the one path where an entity's shape is genuinely unknown:
 * `findById`, which searches the whole heterogeneous world by id. Everywhere
 * else the archetype comes from the query (see `queries.ts`) and no guard is
 * needed.
 *
 * Each guard is derived from the same key list its archetype is, so a guard can
 * never claim more than it checks.
 */

/** Exactly the test miniplex itself runs to decide query membership. */
function hasAll<K extends keyof Entity>(e: Entity, keys: readonly K[]): e is With<Entity, K> {
  return keys.every((k) => e[k] !== undefined);
}

export const isRobot = (e: Entity): e is RobotEntity => hasAll(e, ROBOT_KEYS);
export const isBase = (e: Entity): e is BaseEntity => hasAll(e, BASE_KEYS);
export const isDrone = (e: Entity): e is DroneEntity => hasAll(e, DRONE_KEYS);
export const isMunition = (e: Entity): e is MunitionEntity => hasAll(e, MUNITION_KEYS);
export const isProjectile = (e: Entity): e is ProjectileEntity => hasAll(e, PROJECTILE_KEYS);

export const isPositioned = (e: Entity): e is Positioned => e.position !== undefined;

/**
 * Deliberately **not** a type predicate. `hp > 0` is a fact about a value, not
 * about a shape, and `e is With<Entity, 'hp'>` would read as a stronger claim
 * than it is — a corpse has `hp` too. Combine instead: `isRobot(e) && isAlive(e)`.
 */
export const isAlive = (e: Entity): boolean => (e.hp ?? 0) > 0;
