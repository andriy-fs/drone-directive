import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../utils/math';
import type { BaseEntity, DroneEntity, RobotEntity } from '../ecs/archetypes';
import { isAlive } from '../ecs/guards';
import { drones, robots } from '../ecs/queries';
import type { AiState, GameContext } from '../game/context';
import { unitToward } from './drone';
import { isAdvancing, centroidOf } from './task';
import { enemyBases, enemyRobots, knownEnemyBases, nearest, ownBase } from '../targeting';

/**
 * The bot's observer-drone pilot — the counterweight to the player's own eye.
 *
 * It flies the *same* entity the player does (`systems/drone.ts` drives every
 * drone from `ctx.droneControl[owner]`, and `systems/vision.ts` already counts
 * one as a scout for whichever side owns it), so nothing here duplicates flight,
 * detection or damage. All this module decides is a direction.
 *
 * **Two restrictions, enforced structurally.** The pilot never writes
 * `possessPulse` or `firePulse`, so a bot drone can neither land on a robot nor
 * shoot — the possession mechanic and manual fire stay the player's alone. That
 * has a price the bot pays every second: `isTargetableDrone` only exempts a
 * drone riding a hull, so a bot's drone is *always* exposed to anti-air fire.
 * Shooting it down is the player's answer to it.
 *
 * Called from `runBot` (`systems/ai.ts`), which runs before `droneSystem` in the
 * same tick, so the control written here is consumed immediately — no new place
 * in the pipeline. Randomness comes from `ctx.rng` and only when a waypoint is
 * actually re-picked, so the shared rng stream stays identical across peers.
 */
export function pilotDrone(ctx: GameContext, owner: Owner, state: AiState): void {
  const control = ctx.droneControl[owner];
  // The bot's two restrictions live here and nowhere else.
  control.possessPulse = false;
  control.firePulse = false;

  const drone = drones(ctx.world).entities.find((d) => d.owner === owner && isAlive(d));
  if (!drone) {
    // Shot down: hold the stick neutral and forget the sweep, so the replacement
    // starts from a fresh decision rather than resuming a stale leg.
    control.dir = { x: 0, y: 0 };
    state.droneWaypoint = undefined;
    return;
  }

  const goal = breakOff(ctx, owner, drone) ?? escortGoal(ctx, owner, drone) ?? sweepGoal(ctx, owner, drone, state);
  control.dir = goal ? unitToward(drone.position, goal) : { x: 0, y: 0 };
}

/**
 * Highest priority: get out of an anti-air envelope. Enemy surface-to-air robots
 * and enemy bases (whose built-in battery is exactly such a weapon) both reach
 * 170 px, so `droneDangerRange` sits above that — a drone that only starts
 * running at the edge is already inside it by the time it has turned around.
 *
 * Deliberately reads the raw world rather than `intel`: this is the bot flinching
 * from a threat, not aiming at one, and a scout that has to *spot* the launcher
 * before evading it would simply die to everything it was sent to find.
 */
function breakOff(ctx: GameContext, owner: Owner, drone: DroneEntity): Vec2 | undefined {
  const pos = drone.position;
  const threats: (RobotEntity | BaseEntity)[] = [
    ...enemyRobots(ctx, owner).filter((r) => r.weapon.canHitAir),
    ...enemyBases(ctx, owner).filter((b) => b.weapon.canHitAir),
  ];
  const threat = nearest(pos, threats);
  if (!threat) return undefined;
  const away = distance(pos.x, pos.y, threat.position.x, threat.position.y);
  if (away > gameConfig.ai.droneDangerRange) return undefined;

  return offsetFrom(threat.position, pos, gameConfig.ai.droneDangerRange);
}

/**
 * Scout for the push: sit `droneScoutLead` px *ahead* of the advancing group's
 * centroid, on the line running away from home. The mirror image of
 * `overwatchOutcome`, which trails the same centroid by the same construction —
 * an unarmed spotter follows the wave, an untouchable-by-most flyer leads it.
 *
 * Below `droneCautiousHp` this is skipped: drones never repair (`systems/regen.ts`
 * excludes them by construction), so a damaged one is spent goods and is worth
 * more picketing home than buying one more look at the front.
 */
function escortGoal(ctx: GameContext, owner: Owner, drone: DroneEntity): Vec2 | undefined {
  if (isCautious(drone)) return undefined;

  const home = ownBase(ctx, owner);
  if (!home) return undefined;

  const vanguard = robots(ctx.world).entities.filter((r) => r.owner === owner && isAlive(r) && isAdvancing(r));
  if (vanguard.length === 0) return undefined;

  const centroid = centroidOf(vanguard);
  return offsetFrom(home.position, centroid, gameConfig.ai.droneScoutLead);
}

/**
 * Nothing to escort: sweep. The waypoint is held on `AiState` and re-picked on
 * arrival — the same shape as `roamOutcome`'s `blackboard.roamTarget`, and for
 * the same reason: drawing a fresh point every tick would both jitter the flight
 * path and pull from the shared rng 30 times a second.
 */
function sweepGoal(ctx: GameContext, owner: Owner, drone: DroneEntity, state: AiState): Vec2 {
  const pos = drone.position;
  let target = state.droneWaypoint;
  if (!target || distance(pos.x, pos.y, target.x, target.y) <= gameConfig.ai.droneWaypointRadius) {
    target = pickSweepPoint(ctx, owner, drone);
    state.droneWaypoint = target;
  }
  return target;
}

function pickSweepPoint(ctx: GameContext, owner: Owner, drone: DroneEntity): Vec2 {
  // Damaged: stop scouting and orbit home as early warning instead.
  if (isCautious(drone)) {
    const home = ownBase(ctx, owner);
    if (home) return randomPointAround(ctx, home.position, gameConfig.ai.dronePicketRadius);
  }

  // A base it has already found is worth re-checking — but from *outside* the
  // battery's reach, so watching it doesn't cost the eye. Half the time only:
  // the rest of the map still has to get looked at.
  const known = knownEnemyBases(ctx, owner);
  if (known.length > 0 && ctx.rng.next() < 0.5) {
    const base = ctx.rng.pick(known);
    return randomPointOnRing(ctx, base.position, gameConfig.ai.droneDangerRange);
  }
  return randomWorldPoint(ctx);
}

/** Below `droneCautiousHp` of its hull the drone stops scouting — see `escortGoal`. */
function isCautious(drone: DroneEntity): boolean {
  return drone.maxHp > 0 && drone.hp / drone.maxHp <= gameConfig.ai.droneCautiousHp;
}

/**
 * The point `dist` px beyond `to`, along the line from `from` through it — the
 * "keep going that way" primitive behind both leading a group and running from a
 * launcher. Falls back to `to` when the two coincide (no direction to extend).
 */
function offsetFrom(from: Vec2, to: Vec2, dist: number): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = vecLength(dx, dy);
  if (len < 1e-6) return { x: to.x, y: to.y };
  return clampToWorld(to.x + (dx / len) * dist, to.y + (dy / len) * dist);
}

function randomWorldPoint(ctx: GameContext): Vec2 {
  return {
    x: ctx.rng.next() * worldPixelSize.width,
    y: ctx.rng.next() * worldPixelSize.height,
  };
}

/** A random point within `radius` of `centre`. Obstacle-blind: the drone flies over terrain. */
function randomPointAround(ctx: GameContext, centre: Vec2, radius: number): Vec2 {
  const angle = ctx.rng.next() * Math.PI * 2;
  const r = Math.sqrt(ctx.rng.next()) * radius; // sqrt keeps the draw uniform over the disc
  return clampToWorld(centre.x + Math.cos(angle) * r, centre.y + Math.sin(angle) * r);
}

/** A random point *on* the circle of `radius` around `centre` — a standoff orbit. */
function randomPointOnRing(ctx: GameContext, centre: Vec2, radius: number): Vec2 {
  const angle = ctx.rng.next() * Math.PI * 2;
  return clampToWorld(centre.x + Math.cos(angle) * radius, centre.y + Math.sin(angle) * radius);
}

function clampToWorld(x: number, y: number): Vec2 {
  return {
    x: clamp(x, 0, worldPixelSize.width),
    y: clamp(y, 0, worldPixelSize.height),
  };
}
