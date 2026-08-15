import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import type { With } from 'miniplex';
import type { BaseEntity, RobotEntity } from '../ecs/archetypes';
import type { Entity, EntityKind } from '../ecs/entity';
import { isAlive } from '../ecs/guards';
import { bases, drones, robots } from '../ecs/queries';
import type { GameContext, TeamIntel } from '../game/context';
import { isDisabled } from './status';
import { distanceToBase, enemyAirTargets, enemyBases, enemyRobots, isEnemy } from './targeting';

/**
 * Anything that can see for a side: a robot, a base or the observer drone. All
 * three carry the same four components, which is exactly why one pass covers
 * them — the archetype tag is the only thing that differs, and vision doesn't
 * read it.
 */
type Scout = With<Entity, 'position' | 'owner' | 'hp' | 'sightRange'>;

/**
 * Detection resolver. Each tick, recomputes which enemy robots and **air** units
 * (observer drones and FPV strike drones alike) are currently within sight of
 * some living allied robot or base
 * (real-time — an enemy unit drops out of `visibleRobotIds`/`visibleAirIds`
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
  const isMine = (e: Scout): boolean => e.owner === owner && e.hp > 0 && e.sightRange > 0 && !isDisabled(e);
  const scouts: Scout[] = [
    ...robots(ctx.world).entities.filter(isMine),
    ...bases(ctx.world).entities.filter(isMine),
    // The observer drone spots enemies too (additive) — it isn't a robot, so it
    // needs its own pass. Every side has one, bots included (a bot's is flown by
    // `systems/aiDrone.ts`), so this is where a drone's reach becomes intel.
    ...drones(ctx.world).entities.filter(isMine),
  ];
  // Enemy `ew` robots jamming this side's scouts.
  const jammers = robots(ctx.world).entities.filter(
    (e) => isEnemy(owner, e.owner) && isAlive(e) && e.weapon.jamRadius > 0 && !isDisabled(e),
  );

  // The `enemySpotted` emits below all read the *previous* tick's set, which is
  // still on `intel` until the assignment that follows each loop — that one
  // comparison is the whole rising edge, and it costs no extra state.
  const visible = new Set<string>();
  for (const foe of enemyRobots(ctx, owner)) {
    if (!isSpotted(scouts, jammers, foe.position.x, foe.position.y)) continue;
    if (!intel.visibleRobotIds.has(foe.id)) emitSpotted(ctx, owner, foe.id, 'robot', foe.position);
    visible.add(foe.id);
  }
  intel.visibleRobotIds = visible;

  // Enemy air detects the same way ground units do — this is what anti-air fire
  // shoots at, and what the renderer uses to keep a flyer hidden in the fog. One
  // pass covers both kinds: an observer drone and an incoming strike drone are
  // spotted by exactly the same rule.
  const visibleAir = new Set<string>();
  for (const foe of enemyAirTargets(ctx, owner)) {
    if (!isSpotted(scouts, jammers, foe.position.x, foe.position.y)) continue;
    if (!intel.visibleAirIds.has(foe.id)) emitSpotted(ctx, owner, foe.id, 'drone', foe.position);
    visibleAir.add(foe.id);
  }
  intel.visibleAirIds = visibleAir;

  // Bases are resolved on both timescales, from one test. `knownBaseIds` only
  // grows — a building found once stays found, which is what lets a unit be
  // ordered to attack it without an escort keeping eyes on the door.
  // `visibleBaseIds` is this tick's truth, for the things that need a live
  // observer rather than a memory (an FPV salvo). Every base is tested every
  // tick now, where discovery alone could stop once it was known: there are at
  // most four of them, and the live set has to be able to *shrink*.
  const visibleBases = new Set<string>();
  for (const base of enemyBases(ctx, owner)) {
    if (!isBaseSpotted(scouts, jammers, base)) continue;
    visibleBases.add(base.id);
    // Discovery, not visibility: a building found once stays found, so this
    // announces at most once per base per match — the `visibleBaseIds` edge would
    // re-fire every time the last scout looked away and back.
    if (!intel.knownBaseIds.has(base.id)) emitSpotted(ctx, owner, base.id, 'base', base.position);
    intel.knownBaseIds.add(base.id);
  }
  intel.visibleBaseIds = visibleBases;
}

/**
 * Announces a fresh contact. Copies the position because the entity keeps moving
 * and the listener is an app-layer observer, not a system reading the same tick.
 */
function emitSpotted(ctx: GameContext, owner: Owner, targetId: string, targetKind: EntityKind, pos: Vec2): void {
  ctx.bus.emit('enemySpotted', { owner, targetId, targetKind, pos: { x: pos.x, y: pos.y } });
}

function isSpotted(scouts: Scout[], jammers: RobotEntity[], x: number, y: number): boolean {
  return scouts.some((s) => distance(s.position.x, s.position.y, x, y) <= effectiveSight(s, jammers));
}

/**
 * A base is spotted from its **footprint edge**, not its centre — the one place
 * detection measures something other than a point, because a base is the one
 * thing that is not one. Three tiles of building sit between the two measures, so
 * testing the centre meant a scout could be looking straight at the wall of a
 * base that officially had not been found, and a hull whose weapon outreaches its
 * own sight would have to drive those 48 px into the defender's fire before it
 * was allowed to shoot. Every other system that asks "how far is this from the
 * building" — a bomb's blast, a projectile's collision, a strike drone's approach
 * — already measures it this way (`distanceToBase`); this makes vision the fourth.
 */
function isBaseSpotted(scouts: Scout[], jammers: RobotEntity[], base: BaseEntity): boolean {
  return scouts.some((s) => distanceToBase(s.position, base) <= effectiveSight(s, jammers));
}

/** Scout's own sightRange, halved if it currently sits inside an enemy `ew` robot's jamRadius. */
function effectiveSight(scout: Scout, jammers: RobotEntity[]): number {
  const base = scout.sightRange;
  const jammed = jammers.some(
    (j) => distance(j.position.x, j.position.y, scout.position.x, scout.position.y) <= j.weapon.jamRadius,
  );
  return jammed ? base * gameConfig.combat.jamMultiplier : base;
}
