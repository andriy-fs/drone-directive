import { gameConfig } from '../../config/gameConfig';
import type { Owner } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext, TeamIntel } from '../game/context';
import { isDisabled } from './status';
import { enemyBases, enemyDrones, enemyRobots, isEnemy } from './targeting';

/**
 * Detection resolver. Each tick, recomputes which enemy robots and observer
 * drones are currently within sight of some living allied robot or base
 * (real-time — an enemy unit drops out of `visibleRobotIds`/`visibleDroneIds`
 * the instant no ally can see it, since it moves) and grows the set of enemy
 * bases any ally has ever come within sight
 * of (bases don't move, so discovery is permanent). Both robots and bases have
 * their own `sightRange` (see `gameConfig.robots.chassis[*].sight` /
 * `gameConfig.bases.sightRange`) and contribute vision equally. Living enemy
 * `ew` robots jam nearby scouts: a scout within an `ew` robot's `jamRadius`
 * sees at `sightRange * gameConfig.combat.jamMultiplier` instead of its full
 * range (see `jammers` below). Robots knocked out by a directed-energy hit drop
 * out of both roles — they neither spot nor jam while their electronics are
 * down. This is the sole source of "known" enemies for
 * the directive resolver (`task.ts`) — see `targeting.ts`'s
 * `knownEnemyRobots`/`knownEnemyBases`.
 */
export function visionSystem(ctx: GameContext): void {
  // Every side scouts independently, in roster order (fixed across peers).
  for (const side of ctx.roster) updateSideVision(ctx, side.owner);
}

function updateSideVision(ctx: GameContext, owner: Owner): void {
  const intel: TeamIntel = ctx.intel[owner];
  // A knocked-out robot's sensors are down with the rest of it — it neither
  // spots for its own side nor jams for it (see `jammers` below).
  const isMine = (e: Entity): boolean =>
    e.owner === owner && (e.hp ?? 0) > 0 && (e.sightRange ?? 0) > 0 && !isDisabled(e);
  const scouts = [
    ...ctx.world.with('robot', 'position').entities.filter(isMine),
    ...ctx.world.with('base', 'position').entities.filter(isMine),
    // The observer drone spots enemies too (additive) — it isn't a robot, so it
    // needs its own pass. Bot sides have no drone, so this is empty for them.
    ...ctx.world.with('drone', 'position').entities.filter(isMine),
  ];
  // Enemy `ew` robots jamming this side's scouts.
  const jammers = ctx.world
    .with('robot', 'position', 'weapon')
    .entities.filter(
      (e) => isEnemy(owner, e.owner) && (e.hp ?? 0) > 0 && e.weapon!.jamRadius > 0 && !isDisabled(e),
    );

  const visible = new Set<string>();
  for (const foe of enemyRobots(ctx, owner)) {
    if (isSpotted(scouts, jammers, foe.position!.x, foe.position!.y)) visible.add(foe.id);
  }
  intel.visibleRobotIds = visible;

  // Enemy drones detect the same way ground units do — this is what anti-air
  // fire shoots at, and what the renderer uses to keep one hidden in the fog.
  const visibleDrones = new Set<string>();
  for (const foe of enemyDrones(ctx, owner)) {
    if (isSpotted(scouts, jammers, foe.position!.x, foe.position!.y)) visibleDrones.add(foe.id);
  }
  intel.visibleDroneIds = visibleDrones;

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
