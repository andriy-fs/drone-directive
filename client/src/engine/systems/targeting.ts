import type { Vec2 } from '@drone-directive/types/entities';
import { Owner } from '@drone-directive/types/enums';
import { gameConfig } from '../../config/gameConfig';
import { distance } from '../../utils/math';
import type { Entity, WeaponComp } from '../ecs/entity';
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

export function findById(ctx: GameContext, id: string): Entity | undefined {
  return ctx.world.entities.find((e) => e.id === id);
}

/** Living enemy robots relative to `owner`. */
export function enemyRobots(ctx: GameContext, owner: Owner): Entity[] {
  return ctx.world.with('robot', 'position').entities.filter((e) => (e.hp ?? 0) > 0 && isEnemy(owner, e.owner));
}

/** Living enemy bases relative to `owner`. */
export function enemyBases(ctx: GameContext, owner: Owner): Entity[] {
  return ctx.world.with('base', 'position').entities.filter((e) => (e.hp ?? 0) > 0 && isEnemy(owner, e.owner));
}

/**
 * Whether a drone can be engaged at all. A drone possessing a robot rides inside
 * that hull: it shares the robot's position, so treating it as a target would
 * mean every shot at the carrier incidentally killed the drone too. Free flight
 * is the only exposure — that is the trade the possession mechanic buys.
 */
export function isTargetableDrone(e: Entity): boolean {
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
 */
export function isAirTarget(e: Entity): boolean {
  if (e.munition) return (e.hp ?? 0) > 0;
  return isTargetableDrone(e);
}

/** Living, exposed enemy air relative to `owner` — observer drones and strike drones. */
export function enemyAirTargets(ctx: GameContext, owner: Owner): Entity[] {
  return [
    ...ctx.world.with('drone', 'position').entities,
    ...ctx.world.with('munition', 'position').entities,
  ].filter((e) => isEnemy(owner, e.owner) && isAirTarget(e));
}

/** This owner's own living base, if it still stands. */
export function ownBase(ctx: GameContext, owner: Owner): Entity | undefined {
  return ctx.world.with('base', 'position').entities.find((e) => e.owner === owner && (e.hp ?? 0) > 0);
}

/** Living enemy robots `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyRobots(ctx: GameContext, owner: Owner): Entity[] {
  const visible = ctx.intel[owner].visibleRobotIds;
  return enemyRobots(ctx, owner).filter((e) => visible.has(e.id));
}

/** Living enemy bases `owner`'s team has ever discovered (see `visionSystem`). */
export function knownEnemyBases(ctx: GameContext, owner: Owner): Entity[] {
  const known = ctx.intel[owner].knownBaseIds;
  return enemyBases(ctx, owner).filter((e) => known.has(e.id));
}

/** Exposed enemy air `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyAir(ctx: GameContext, owner: Owner): Entity[] {
  const visible = ctx.intel[owner].visibleAirIds;
  return enemyAirTargets(ctx, owner).filter((e) => visible.has(e.id));
}

/**
 * Whether `owner`'s team has eyes on `target` **right now** — the gate on
 * launching a salvo (see `fireWeapon`). Everything else in the engine gets this
 * for free by picking targets through the `known*` helpers above; a salvo needs
 * it stated outright because a player's explicit `AttackTarget` order and manual
 * fire from a possessed hull both bypass target *selection*, and a weapon that
 * reaches the whole map would otherwise shell things nobody is looking at.
 *
 * **Bases read `visibleBaseIds`, not `knownBaseIds`.** That distinction is the
 * whole point of this function: `knownBaseIds` only ever grows, so a carrier
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
export function distanceToBase(p: Vec2, base: Entity): number {
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2;
  const bp = base.position!;
  const cx = Math.max(bp.x - half, Math.min(p.x, bp.x + half));
  const cy = Math.max(bp.y - half, Math.min(p.y, bp.y + half));
  return distance(p.x, p.y, cx, cy);
}

/** Whether `w` is a weapon whose only effect is a knock-out (`dew`). */
function isDisabler(w: WeaponComp | undefined): boolean {
  return !!w && w.damage <= 0 && w.freezeDuration > 0;
}

/**
 * Whether `shooter` firing at `target` right now would accomplish anything.
 * Ordinary weapons always do — damage always lands. A disabler (`dew`) has two
 * empty cases: the target is already knocked out (`applyDisable` takes the max
 * of the two durations, not their sum, so a second hit buys almost nothing),
 * and the target is a base (no crew to knock out — `stepProjectiles` lets such
 * a shot pass straight through, see `combat.ts`). Used to keep automatic target
 * selection from spending a `dew`'s five-second reload on a shot that changes
 * nothing; a player's explicit order (`AttackTarget`, manual piloting) is not
 * filtered by this.
 */
export function worthShooting(shooter: Entity, target: Entity): boolean {
  if (!isDisabler(shooter.weapon)) return true;
  return !target.base && !isDisabled(target);
}

/** Nearest entity (by position) to `from`, or undefined. */
export function nearest(from: Vec2, list: Entity[]): Entity | undefined {
  let best: Entity | undefined;
  let bestDist = Infinity;
  for (const e of list) {
    if (!e.position) continue;
    const d = distance(from.x, from.y, e.position.x, e.position.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
