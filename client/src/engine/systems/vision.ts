import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner } from '@drone-directive/types/enums';
import { distance, vecLength } from '../../utils/math';
import type { With } from 'miniplex';
import type { BaseEntity, RobotEntity } from '../ecs/archetypes';
import type { Entity, EntityKind } from '../ecs/entity';
import { isAlive } from '../ecs/guards';
import { bases, drones, robots } from '../ecs/queries';
import type { GameContext, TeamIntel } from '../game/context';
import { isDisabled } from '../status';
import { distanceToBase, enemyAirTargets, enemyBases, enemyRobots, isEnemy, possessedRobotOf } from './targeting';

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
    // A drone riding a hull has stopped being an eye — see `sightlinesFor`.
    ...drones(ctx.world).entities.filter((d) => isMine(d) && !d.drone.possessedId),
  ];
  // Ranges and sectors resolved once for the whole tick: the loops below ask about
  // them once per foe per scout.
  const lines = sightlinesFor(ctx, owner, scouts);

  // The `enemySpotted` emits below all read the *previous* tick's set, which is
  // still on `intel` until the assignment that follows each loop — that one
  // comparison is the whole rising edge, and it costs no extra state.
  const visible = new Set<string>();
  for (const foe of enemyRobots(ctx, owner)) {
    if (!isSpotted(lines, foe.position.x, foe.position.y)) continue;
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
    if (!isSpotted(lines, foe.position.x, foe.position.y)) continue;
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
    if (!isBaseSpotted(lines, base)) continue;
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

function isSpotted(lines: readonly Sightline[], x: number, y: number): boolean {
  return lines.some((l) => withinSight(l.scout, x, y, l.range, l.cone));
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
function isBaseSpotted(lines: readonly Sightline[], base: BaseEntity): boolean {
  return lines.some(
    (l) =>
      distanceToBase(l.scout.position, base) <= l.range &&
      // The range is measured to the footprint edge and the bearing to the centre.
      // They differ by up to half a footprint, which at these ranges is a couple of
      // degrees of a 90° sector — and erring toward "not seen" on a building that is
      // rediscovered the moment the hull turns is the cheap side of that.
      (!l.cone || facesPoint(l.scout, base.position.x, base.position.y, l.cone)),
  );
}

/**
 * The forward sector a scout is limited to, precomputed once per scout.
 *
 * Stored as a unit vector and a cosine rather than an angle, so the per-cell test is
 * a dot product and a compare. `atan2` per cell would be the obvious way to write it
 * and the fog mask alone asks the question ~50 000 times a tick.
 */
export interface SightCone {
  /** Unit forward vector — the scout's heading. */
  fx: number;
  fy: number;
  /** Cosine of the half-angle: the dot product a point has to clear. */
  cosHalf: number;
}

/** The sector a hull facing `heading` sees in. Width comes from `gameConfig.drone.fpv`. */
export function sightCone(heading: number): SightCone {
  return {
    fx: Math.cos(heading),
    fy: Math.sin(heading),
    cosHalf: Math.cos((gameConfig.drone.fpv.sightHalfAngleDeg * Math.PI) / 180),
  };
}

/** One scout resolved for this tick: how far it sees, and the sector it is limited to. */
export interface Sightline {
  scout: Scout;
  range: number;
  /** Absent for everything that still sees a full circle, which is nearly everything. */
  cone?: SightCone;
}

/**
 * Resolve a side's scouts for this tick: jamming folded into each range, and the
 * cone put on the one hull its drone is riding.
 *
 * **Both `visionSystem` and `fogSystem` call this**, and that is the whole point.
 * The two used to work out sight independently and had already drifted once (see
 * `jamPressure`); a cone applied by only one of them would be worse than either
 * drift, because the fog mask and the detection set would be answering different
 * questions about the same eye.
 *
 * Which scouts are *eligible* stays with each caller — they disagree about a
 * knocked-out scout, and settling that is not this function's business.
 */
export function sightlinesFor(ctx: GameContext, owner: Owner, scouts: readonly Scout[]): Sightline[] {
  const jammers = jammersAgainst(ctx, owner);
  // Exactly one hull per side can be ridden, so this is one lookup, not one per scout.
  const possessed = possessedRobotOf(ctx, owner);
  const cone = possessed ? sightCone(possessed.heading) : undefined;
  return scouts.map((scout) => ({
    scout,
    range: effectiveSight(scout, jammers),
    cone: possessed && scout.id === possessed.id ? cone : undefined,
  }));
}

/**
 * Whether a scout sees the point — its range, and its sector if it has one.
 *
 * The one predicate detection and the fog mask share. Exported because they are in
 * different files and there is no version of "the two may each write their own"
 * that ends well: the fog would reveal ground the side is not allowed to have
 * spotted from, or hide ground it did.
 */
export function withinSight(scout: Scout, x: number, y: number, range: number, cone?: SightCone): boolean {
  if (distance(scout.position.x, scout.position.y, x, y) > range) return false;
  return !cone || facesPoint(scout, x, y, cone);
}

/**
 * The sector half of `withinSight`, on its own — the base test needs it, because a
 * base's *range* is measured to its footprint edge rather than to the point this
 * takes.
 */
export function facesPoint(scout: Scout, x: number, y: number, cone: SightCone): boolean {
  const dx = x - scout.position.x;
  const dy = y - scout.position.y;
  // `vecLength`, never `Math.hypot`: the latter is not required to be correctly
  // rounded, so two engines can disagree on the last bit — and sight feeds
  // `task.ts`, which makes any disagreement here a desync. `hygiene.test.ts`
  // enforces this, and caught exactly this line.
  const len = vecLength(dx, dy);
  // Standing on it. Nothing to be behind you about, and the normalisation would
  // divide by zero.
  if (len <= 0) return true;
  return dx * cone.fx + dy * cone.fy >= cone.cosHalf * len;
}

/** Scout's own sightRange, halved if it currently sits inside an enemy `ew` robot's jamRadius. */
function effectiveSight(scout: Scout, jammers: readonly RobotEntity[]): number {
  const base = scout.sightRange;
  return jamPressureFrom(jammers, scout.position.x, scout.position.y) > 0
    ? base * gameConfig.combat.jamMultiplier
    : base;
}

/**
 * Enemy `ew` robots currently jamming `owner` — living, and with their own
 * electronics up. A knocked-out jammer emits nothing, exactly as a knocked-out
 * scout sees nothing (see `updateSideVision`).
 *
 * Exported alongside `jamPressure` for one reason: the callers that ask about
 * *many* points (every tile of the fog mask, every foe against every scout) must
 * resolve the set once per tick rather than per question. `jamPressure` is the
 * one-shot form for callers with a single point.
 */
export function jammersAgainst(ctx: GameContext, owner: Owner): RobotEntity[] {
  return robots(ctx.world).entities.filter(
    (e) => isEnemy(owner, e.owner) && isAlive(e) && e.weapon.jamRadius > 0 && !isDisabled(e),
  );
}

/**
 * How hard a point is being jammed: `0` outside every enemy jamming aura, rising
 * to `1` at the centre of the strongest one.
 *
 * **This is the one place the jamming rule lives.** It used to be written out
 * twice — once in `effectiveSight` here and once in `fogSystem`'s
 * `effectiveRanges` — and the two had already drifted apart on whether a
 * *disabled* jammer still jams. Both now ask this, so they cannot disagree again.
 *
 * The number is more than the boolean those two need, because the hull view reads
 * it as a *pressure*: how badly a pilot's monitor is being torn up. That is what
 * makes `combat.jamMultiplier` visible at all — until now it was a smaller number
 * inside two systems and nothing at all on screen.
 *
 * **Counted from every jammer, seen or not, deliberately.** Interference tells you
 * that you are being jammed, not where the jammer is standing; gating it on
 * detection would turn a warning into a targeting aid.
 *
 * One boundary note, since the sight rule reads this as a predicate: a point at
 * *exactly* `jamRadius` now reads as unjammed where the old `<=` called it jammed.
 * At the edge of an aura the influence is zero either way, and no float coordinate
 * lands there on purpose.
 */
export function jamPressureFrom(jammers: readonly RobotEntity[], x: number, y: number): number {
  let worst = 0;
  for (const j of jammers) {
    const radius = j.weapon.jamRadius;
    if (radius <= 0) continue;
    const d = distance(j.position.x, j.position.y, x, y);
    if (d >= radius) continue;
    const pressure = 1 - d / radius;
    if (pressure > worst) worst = pressure;
  }
  return worst;
}

/** `jamPressureFrom` for a caller with one point to ask about — resolves the set itself. */
export function jamPressure(ctx: GameContext, owner: Owner, pos: Vec2): number {
  return jamPressureFrom(jammersAgainst(ctx, owner), pos.x, pos.y);
}
