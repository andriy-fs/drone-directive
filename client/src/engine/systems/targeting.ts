import type { Vec2 } from '@drone-directive/types/entities';
import { Owner } from '@drone-directive/types/enums';
import { gameConfig } from '../../config/gameConfig';
import { distance } from '../../utils/math';
import type { With } from 'miniplex';
import type { BaseEntity, DroneEntity, MunitionEntity, Positioned, RobotEntity } from '../ecs/archetypes';
import type { Entity, WeaponComp } from '../ecs/entity';
import { isAlive, isBase, isRobot } from '../ecs/guards';
import { bases, drones, munitions, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { isDisabled } from './status';

/**
 * Whether `p` falls inside a base's footprint — the base hit-test, shared by
 * jam detection, right-click targeting and base selection so the three cannot
 * drift apart. Bases are square and axis-aligned, hence the AABB.
 */
export function baseFootprintContains(base: Entity, p: Vec2): boolean {
  const pos = base.position;
  if (!pos) return false;
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2;
  return Math.abs(p.x - pos.x) <= half && Math.abs(p.y - pos.y) <= half;
}

/** Two owners are enemies if they differ and neither party is neutral. */
export function isEnemy(a: Owner | undefined, b: Owner | undefined): boolean {
  return a !== undefined && b !== undefined && a !== b && b !== Owner.Neutral;
}

/**
 * The one lookup that hands back an entity of genuinely unknown shape — it
 * searches the whole heterogeneous world. Prefer the typed wrappers below when
 * you know what you are looking for; they turn "I asserted a component" into "I
 * checked for one".
 */
export function findById(ctx: GameContext, id: string): Entity | undefined {
  return ctx.world.entities.find((e) => e.id === id);
}

/** `findById` narrowed to a robot — undefined if the id names anything else. */
export function robotById(ctx: GameContext, id: string): RobotEntity | undefined {
  const e = findById(ctx, id);
  return e && isRobot(e) ? e : undefined;
}

/** `findById` narrowed to a base — undefined if the id names anything else. */
export function baseById(ctx: GameContext, id: string): BaseEntity | undefined {
  const e = findById(ctx, id);
  return e && isBase(e) ? e : undefined;
}

/** As `robotById`, but a wreck not yet reaped reads as gone. */
export function livingRobotById(ctx: GameContext, id: string): RobotEntity | undefined {
  const e = robotById(ctx, id);
  return e && isAlive(e) ? e : undefined;
}

/** Living enemy robots relative to `owner`. */
export function enemyRobots(ctx: GameContext, owner: Owner): RobotEntity[] {
  return robots(ctx.world).entities.filter((e) => isAlive(e) && isEnemy(owner, e.owner));
}

/** Living enemy bases relative to `owner`. */
export function enemyBases(ctx: GameContext, owner: Owner): BaseEntity[] {
  return bases(ctx.world).entities.filter((e) => isAlive(e) && isEnemy(owner, e.owner));
}

/**
 * Whether a drone can be engaged at all. A drone possessing a robot rides inside
 * that hull: it shares the robot's position, so treating it as a target would
 * mean every shot at the carrier incidentally killed the drone too. Free flight
 * is the only exposure — that is the trade the possession mechanic buys.
 */
export function isTargetableDrone(e: Entity): e is With<Entity, 'drone'> {
  return !!e.drone && (e.hp ?? 0) > 0 && !e.drone.possessedId;
}

/**
 * Whether `e` is something only a `canHitAir` weapon may shoot: an exposed
 * observer drone, or an FPV strike drone in flight.
 *
 * This predicate — not the component tag — is what "air" means in the engine.
 * The two flyers deliberately wear different tags (see `Entity.munition`), and
 * every anti-air path keys off this instead, so adding a third flyer is one line
 * here rather than a hunt through the targeting, vision and combat systems.
 *
 * Stays a plain boolean rather than a type predicate: it spans two archetypes,
 * and the arrays it filters are already typed by the queries that built them, so
 * a guard would add a claim without adding information.
 */
export function isAirTarget(e: Entity): boolean {
  if (e.munition) return (e.hp ?? 0) > 0;
  return isTargetableDrone(e);
}

/** Living, exposed enemy air relative to `owner` — observer drones and strike drones. */
export function enemyAirTargets(ctx: GameContext, owner: Owner): (DroneEntity | MunitionEntity)[] {
  return [...drones(ctx.world).entities, ...munitions(ctx.world).entities].filter(
    (e) => isEnemy(owner, e.owner) && isAirTarget(e),
  );
}

/** This owner's own living base, if it still stands. */
export function ownBase(ctx: GameContext, owner: Owner): BaseEntity | undefined {
  return bases(ctx.world).entities.find((e) => e.owner === owner && isAlive(e));
}

/** Living enemy robots `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyRobots(ctx: GameContext, owner: Owner): RobotEntity[] {
  const visible = ctx.intel[owner].visibleRobotIds;
  return enemyRobots(ctx, owner).filter((e) => visible.has(e.id));
}

/** Living enemy bases `owner`'s team has ever discovered (see `visionSystem`). */
export function knownEnemyBases(ctx: GameContext, owner: Owner): BaseEntity[] {
  const known = ctx.intel[owner].knownBaseIds;
  return enemyBases(ctx, owner).filter((e) => known.has(e.id));
}

/** Exposed enemy air `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyAir(ctx: GameContext, owner: Owner): (DroneEntity | MunitionEntity)[] {
  const visible = ctx.intel[owner].visibleAirIds;
  return enemyAirTargets(ctx, owner).filter((e) => visible.has(e.id));
}

/**
 * Whether `owner`'s team has eyes on `target` **right now** — the gate every
 * weapon passes before it fires (see `fireWeapon`). Automatic target *selection*
 * already provides this by going through the `known*` helpers above; the gate is
 * stated outright because two paths bypass selection — a player's explicit
 * `AttackTarget` order and manual fire from a possessed hull — and because reach
 * beyond a hull's own `sight` (`missiles` at 255 against a 230 chassis, `fpv` at
 * map scale) would otherwise be a licence to shell the fog.
 *
 * **Bases read `visibleBaseIds`, not `knownBaseIds`.** That distinction is the
 * whole point of this function: `knownBaseIds` only ever grows, so a shooter
 * gated on it would fire on the enemy base forever after one glimpse early in
 * the match — the reconnaissance requirement, which is the *only* thing bounding
 * a 4000-range weapon, would quietly switch itself off.
 */
export function isKnownTo(ctx: GameContext, owner: Owner, target: Entity): boolean {
  const intel = ctx.intel[owner];
  if (target.base) return intel.visibleBaseIds.has(target.id);
  if (target.robot) return intel.visibleRobotIds.has(target.id);
  return intel.visibleAirIds.has(target.id);
}

/**
 * Distance from point `p` to the nearest point of `base`'s footprint AABB — the
 * "how far is this thing from the building" measure, as opposed to
 * `baseFootprintContains`'s "is it inside". Lives here rather than in any one
 * system because three of them need it: a bomb's blast, a projectile's collision
 * and a strike drone's approach must agree on where a base *begins*.
 */
export function distanceToBase(p: Vec2, base: BaseEntity): number {
  const half = (base.footprint * gameConfig.grid.tilePx) / 2;
  const bp = base.position;
  const cx = Math.max(bp.x - half, Math.min(p.x, bp.x + half));
  const cy = Math.max(bp.y - half, Math.min(p.y, bp.y + half));
  return distance(p.x, p.y, cx, cy);
}

/**
 * Damage already on its way to `targetId` — the sum every strike drone still in
 * the air is carrying for it.
 *
 * There is no separate book to keep: a salvo *is* its munitions, each one an
 * entity holding its own `damage` and the id it locked at launch, so the world
 * already answers "how much is committed to this target". Every side's drones
 * count, not just one: a target being finished off by an ally is no more worth a
 * volley than one being finished off by us.
 */
export function incomingSalvoDamage(ctx: GameContext, targetId: string): number {
  let sum = 0;
  for (const m of munitions(ctx.world)) {
    if (m.targetId === targetId && m.hp > 0) sum += m.damage;
  }
  return sum;
}

/**
 * Whether `target` is already dead on paper — the drones in the air will finish
 * it without help. The gate on launching *another* salvo at it, and the reason a
 * dozen carriers watching one scout don't all empty their tubes into it: a
 * launcher's 9-second reload is the expensive thing here, far more so than the
 * five drones, and it is exactly what this saves for the next target.
 *
 * A base's dome counts toward the pool it has to chew through, otherwise the
 * carriers would fall silent in front of a base that is nowhere near falling.
 */
export function alreadyDoomed(ctx: GameContext, target: Entity): boolean {
  const pool = (target.hp ?? 0) + (target.shield?.hp ?? 0);
  return pool - incomingSalvoDamage(ctx, target.id) <= 0;
}

/** Whether `w` is a launcher — one trigger pull, `salvo` flying munitions. */
function isLauncher(w: WeaponComp | undefined): boolean {
  return !!w && w.salvo > 0;
}

/** Whether `w` is a weapon whose only effect is a knock-out (`dew`). */
function isDisabler(w: WeaponComp | undefined): boolean {
  return !!w && w.damage <= 0 && w.freezeDuration > 0;
}

/**
 * Whether `shooter` firing at `target` right now would accomplish anything.
 * Ordinary weapons usually do — damage always lands. Two weapons have empty
 * cases worth skipping:
 *
 * - a **launcher** (`fpv`) aimed at something the drones already in the air will
 *   kill anyway (`alreadyDoomed`);
 * - a **disabler** (`dew`) aimed at a robot that is already knocked out
 *   (`applyDisable` takes the max of the two durations, not their sum, so a
 *   second hit buys almost nothing) or at a base (no crew to knock out —
 *   `stepProjectiles` lets such a shot pass straight through, see `combat.ts`).
 *
 * Being false here does not merely hold fire: this is what automatic *selection*
 * filters on, so the shooter moves on to the next enemy instead of standing over
 * a corpse — which is the whole point for a launcher, where the alternative is
 * nine idle seconds. A player's explicit order (`AttackTarget`, manual piloting)
 * is not filtered by this; the launch-time gate that catches those lives in
 * `fireWeapon`.
 */
export function worthShooting(ctx: GameContext, shooter: Entity, target: Entity): boolean {
  if (isLauncher(shooter.weapon) && alreadyDoomed(ctx, target)) return false;
  if (!isDisabler(shooter.weapon)) return true;
  return !target.base && !isDisabled(target);
}

/**
 * Nearest entity (by position) to `from`, or undefined. Generic so the caller
 * keeps its element type — picking the closest robot out of a list of robots
 * hands back a robot, not an `Entity` the caller has to re-narrow.
 */
export function nearest<T extends Positioned>(from: Vec2, list: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const e of list) {
    const d = distance(from.x, from.y, e.position.x, e.position.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
