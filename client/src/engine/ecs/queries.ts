import type { Query } from 'miniplex';
import {
  BASE_KEYS,
  DRONE_KEYS,
  EXPLOSION_KEYS,
  MUNITION_KEYS,
  PROJECTILE_KEYS,
  ROBOT_KEYS,
  type BaseEntity,
  type DroneEntity,
  type ExplosionEntity,
  type MunitionEntity,
  type Positioned,
  type ProjectileEntity,
  type RobotEntity,
  type ShieldedBase,
} from './archetypes';
import type { EcsWorld } from './world';

/**
 * The archetype queries, declared once instead of spelled out at ~50 call sites.
 *
 * **Why the key lists are the full spawner shape rather than the two or three
 * components a given system reads.** An entity's component set is fixed at
 * spawn: `factory.ts` is the only caller of `world.add`, and the only components
 * ever attached or detached afterwards are `shield`/`shieldSpent`, in
 * `systems/combat/shield.ts`. So `with('robot', 'position', 'movement')` and
 * `with(...ROBOT_KEYS)` select the *same entities* — no robot has ever lacked
 * `weapon` or `script`. Widening is therefore behaviour-neutral by construction,
 * and it buys the thing narrower tuples can't: the return type below is
 * **checked by the compiler**, not asserted with a cast. There is no `as` in
 * this file, and none left in `WorldRenderer` either.
 *
 * The corollary for anyone adding a component: if it can be added or removed
 * mid-match, it must **not** go in a key list. Give it an intersection type and
 * its own query, the way `shieldedBases` handles the dome.
 *
 * These are functions, not a prebuilt registry object, because `World.with()`
 * already "creates (or reuses)" a cached query keyed on its component list —
 * calling one per tick allocates nothing, and a stateful registry would only add
 * a second lifecycle to keep in step with the per-match world.
 */

export const robots = (w: EcsWorld): Query<RobotEntity> => w.with(...ROBOT_KEYS);
export const bases = (w: EcsWorld): Query<BaseEntity> => w.with(...BASE_KEYS);
export const drones = (w: EcsWorld): Query<DroneEntity> => w.with(...DRONE_KEYS);
export const munitions = (w: EcsWorld): Query<MunitionEntity> => w.with(...MUNITION_KEYS);
export const projectiles = (w: EcsWorld): Query<ProjectileEntity> => w.with(...PROJECTILE_KEYS);
export const explosions = (w: EcsWorld): Query<ExplosionEntity> => w.with(...EXPLOSION_KEYS);

/** Bases whose energy dome is standing right now — the component *is* the query. */
export const shieldedBases = (w: EcsWorld): Query<ShieldedBase> => w.with(...BASE_KEYS, 'shield');

/** Everything on the map, whatever kind — `reapSystem`'s sweep. */
export const positioned = (w: EcsWorld): Query<Positioned> => w.with('position');
