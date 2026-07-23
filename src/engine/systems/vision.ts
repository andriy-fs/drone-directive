import { gameConfig } from '../../config/gameConfig';
import { Owner } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext, TeamIntel } from '../game/context';
import { enemyBases, enemyRobots, isEnemy } from './targeting';

/**
 * Detection resolver. Each tick, recomputes which enemy robots are currently
 * within sight of some living allied robot or base (real-time — an enemy robot
 * drops out of `visibleRobotIds` the instant no ally can see it, since it
 * moves) and grows the set of enemy bases any ally has ever come within sight
 * of (bases don't move, so discovery is permanent). Both robots and bases have
 * their own `sightRange` (see `gameConfig.robots.chassis[*].sight` /
 * `gameConfig.bases.sightRange`) and contribute vision equally. Living enemy
 * `ew` robots jam nearby scouts: a scout within an `ew` robot's `jamRadius`
 * sees at `sightRange * gameConfig.combat.jamMultiplier` instead of its full
 * range (see `jammers` below). This is the sole source of "known" enemies for
 * the directive resolver (`task.ts`) — see `targeting.ts`'s
 * `knownEnemyRobots`/`knownEnemyBases`.
 */
export function visionSystem(ctx: GameContext): void {
  updateSideVision(ctx, Owner.Player);
  updateSideVision(ctx, Owner.AI);
}

function updateSideVision(ctx: GameContext, owner: Owner): void {
  const intel: TeamIntel = owner === Owner.AI ? ctx.intel.ai : ctx.intel.player;
  const isMine = (e: Entity): boolean => e.owner === owner && (e.hp ?? 0) > 0 && (e.sightRange ?? 0) > 0;
  const scouts = [
    ...ctx.world.with('robot', 'position').entities.filter(isMine),
    ...ctx.world.with('base', 'position').entities.filter(isMine),
    // The observer drone spots enemies too (additive); it has no hp, so match on
    // owner + sight only. AI has no drone, so this is empty for that side.
    ...ctx.world
      .with('drone', 'position')
      .entities.filter((e) => e.owner === owner && (e.sightRange ?? 0) > 0),
  ];
  // Enemy `ew` robots jamming this side's scouts.
  const jammers = ctx.world
    .with('robot', 'position', 'weapon')
    .entities.filter((e) => isEnemy(owner, e.owner) && (e.hp ?? 0) > 0 && e.weapon!.jamRadius > 0);

  const visible = new Set<string>();
  for (const foe of enemyRobots(ctx, owner)) {
    if (isSpotted(scouts, jammers, foe.position!.x, foe.position!.y)) visible.add(foe.id);
  }
  intel.visibleRobotIds = visible;

  for (const base of enemyBases(ctx, owner)) {
    if (intel.knownBaseIds.has(base.id)) continue;
    if (isSpotted(scouts, jammers, base.position!.x, base.position!.y)) intel.knownBaseIds.add(base.id);
  }
}

function isSpotted(scouts: Entity[], jammers: Entity[], x: number, y: number): boolean {
  return scouts.some((s) => s.position && distance(s.position.x, s.position.y, x, y) <= effectiveSight(s, jammers));
}

/** Scout's own sightRange, halved if it currently sits inside an enemy `ew` robot's jamRadius. */
function effectiveSight(scout: Entity, jammers: Entity[]): number {
  const base = scout.sightRange ?? 0;
  const jammed = jammers.some(
    (j) => distance(j.position!.x, j.position!.y, scout.position!.x, scout.position!.y) <= j.weapon!.jamRadius,
  );
  return jammed ? base * gameConfig.combat.jamMultiplier : base;
}
