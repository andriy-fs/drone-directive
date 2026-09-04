import type { With } from 'miniplex';
import type { Entity } from './entity';

/**
 * Named shapes for the entity kinds `factory.ts` builds.
 *
 * `entity.ts` is the storage schema — a flat bag of optional components, which
 * is what miniplex's `World<E>` needs and what lets `world.addComponent` bolt a
 * dome onto a base mid-match. This file is the *derived* layer that says what a
 * robot actually looks like, so a system that iterates robots stops asserting
 * facts the query already established.
 *
 * **Each key list mirrors one spawner's object literal.** They can't drift:
 * `factory.ts` annotates its return types with these aliases, so a spawner that
 * forgets a field fails to compile. That is what makes the queries in
 * `queries.ts` type-safe without a single cast — see the note there.
 *
 * The one thing a key list may **not** contain is a component that comes and
 * goes after spawn; those get an intersection instead (`ShieldedBase`).
 */

/** Every component `spawnRobot` sets. */
export const ROBOT_KEYS = [
  'robot',
  'owner',
  'position',
  'heading',
  'hp',
  'maxHp',
  'chassis',
  'weaponType',
  'movement',
  'weapon',
  'sightRange',
  'script',
  'threat',
] as const satisfies readonly (keyof Entity)[];

/** Every component `spawnBase` sets. */
export const BASE_KEYS = [
  'base',
  'owner',
  'position',
  'heading',
  'hp',
  'maxHp',
  'footprint',
  'sightRange',
  'weaponType',
  'weapon',
  'production',
] as const satisfies readonly (keyof Entity)[];

/** Every component `spawnDrone` sets. A drone has no weapon and no movement. */
export const DRONE_KEYS = [
  'drone',
  'owner',
  'position',
  'heading',
  'hp',
  'maxHp',
  'sightRange',
] as const satisfies readonly (keyof Entity)[];

/** Every component `spawnMunition` sets. No `velocity` — it re-steers each tick. */
export const MUNITION_KEYS = [
  'munition',
  'owner',
  'position',
  'heading',
  'hp',
  'maxHp',
  'targetId',
  'damage',
  'sourceId',
  'ttl',
  'weaponType',
] as const satisfies readonly (keyof Entity)[];

/**
 * Every component `spawnProjectile` sets. Deliberately **without** `targetId`
 * (the spawner takes `string | undefined` — a round can be aimed at a point)
 * and without `heading`, which a projectile never carries: its `velocity` is
 * fixed at launch, so the renderer reads direction off that instead.
 */
export const PROJECTILE_KEYS = [
  'projectile',
  'owner',
  'position',
  'velocity',
  'damage',
  'sourceId',
  'ttl',
  'weaponType',
] as const satisfies readonly (keyof Entity)[];

/**
 * Every component the three transient-effect spawners set (`spawnExplosion`,
 * `spawnShieldEnd`, `spawnEmpBurst` share one archetype — only `effect.kind`
 * differs, because nothing about how an effect *lives* changes).
 */
export const EXPLOSION_KEYS = ['explosion', 'position', 'effect'] as const satisfies readonly (keyof Entity)[];

export type RobotEntity = With<Entity, (typeof ROBOT_KEYS)[number]>;
export type BaseEntity = With<Entity, (typeof BASE_KEYS)[number]>;
export type DroneEntity = With<Entity, (typeof DRONE_KEYS)[number]>;
export type MunitionEntity = With<Entity, (typeof MUNITION_KEYS)[number]>;
export type ProjectileEntity = With<Entity, (typeof PROJECTILE_KEYS)[number]>;
export type ExplosionEntity = With<Entity, (typeof EXPLOSION_KEYS)[number]>;

/**
 * Facets — for helpers that don't care what kind of thing they were handed,
 * only that it has the one component they read.
 */
export type Positioned = With<Entity, 'position'>;
export type Owned = With<Entity, 'owner'>;
export type Living = With<Entity, 'hp' | 'maxHp'>;

/**
 * Anything that can be given a destination. Only robots have `movement` today,
 * but `setGoal`/`clearGoal` read nothing else, and saying so keeps the
 * navigation API usable from a loop that has proved less than a whole robot.
 */
export type Navigable = With<Entity, 'position' | 'movement'>;

/**
 * Anything that carries a weapon and can be told to fire it. Robots and bases
 * differ by their archetype tag and nothing else `fireWeapon` reads, which is
 * why `combatSystem` runs the same helper over two queries.
 */
export type Shooter = RobotEntity | BaseEntity;

/**
 * A base whose energy dome is up **right now**. An intersection rather than a
 * widened key list, because `shield` is the one component attached and detached
 * mid-match — and only ever through `world.addComponent`/`removeComponent` in
 * `systems/combat/shield.ts`. This type does not license `base.shield = {...}`; see the
 * doc comment on `Shield` in `entity.ts` for why that would compile and still
 * be invisible to every query.
 */
export type ShieldedBase = BaseEntity & With<Entity, 'shield'>;
