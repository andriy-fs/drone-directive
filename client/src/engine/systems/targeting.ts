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

/** Enemy drones relative to `owner` that are currently exposed (see `isTargetableDrone`). */
export function enemyDrones(ctx: GameContext, owner: Owner): Entity[] {
  return ctx.world.with('drone', 'position').entities.filter((e) => isEnemy(owner, e.owner) && isTargetableDrone(e));
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

/** Exposed enemy drones `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyDrones(ctx: GameContext, owner: Owner): Entity[] {
  const visible = ctx.intel[owner].visibleDroneIds;
  return enemyDrones(ctx, owner).filter((e) => visible.has(e.id));
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
