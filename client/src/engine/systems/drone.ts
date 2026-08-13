import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { TaskType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../utils/math';
import type { DroneEntity, Positioned, RobotEntity } from '../ecs/archetypes';
import { spawnProjectile } from '../ecs/factory';
import { isAlive } from '../ecs/guards';
import { drones, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { isBlockedGrid, tileOf } from '../obstacles';
import { canEngage, detonateBomb, launchSalvo, withinMunitionReach } from './combat';
import { isDisabled } from './status';
import { enemyBases, enemyRobots, isKnownTo, livingRobotById, nearest } from './targeting';

/**
 * Observer-drone flight. A drone free-flies ignoring obstacles (it never
 * pathfinds), and can land on an idle friendly robot to possess it — then it
 * steers that robot directly (obstacle-checked, so the robot still stops at
 * walls) and fires/detonates its weapon on demand (fully manual — no auto-fire).
 *
 * Runs after `taskSystem` so it can override the target the Idle resolver set,
 * keeping a possessed robot's fire strictly manual. Every side has a drone, and
 * each is driven by its owner's slot in `ctx.droneControl`: the app bridge fills
 * a human's from local input (and, online, the peer's networked input), while a
 * bot's is filled by `systems/aiDrone.ts` earlier in the same tick. This system
 * cannot tell the difference, which is the point — possession and manual fire
 * work identically for whoever is on the stick.
 */
export function droneSystem(ctx: GameContext, dt: number): void {
  for (const drone of [...drones(ctx.world).entities]) driveDrone(ctx, dt, drone);
}

function driveDrone(ctx: GameContext, dt: number, drone: DroneEntity): void {
  const control = ctx.droneControl[drone.owner];
  const dir = normalize(control.dir);

  const possessedId = drone.drone.possessedId;
  const robot = possessedId ? livingRobotById(ctx, possessedId) : undefined;

  if (robot) {
    drivePossessed(ctx, dt, drone, robot, dir, control.possessPulse, control.firePulse);
  } else {
    // The possessed robot is gone (e.g. a kamikaze detonated) — drop to free flight.
    drone.drone.possessedId = undefined;
    freeFly(ctx, dt, drone, dir, control.possessPulse);
  }

  control.possessPulse = false;
  control.firePulse = false;
}

/** Free flight: obstacle-free movement, plus landing on an idle robot on demand. */
function freeFly(ctx: GameContext, dt: number, drone: DroneEntity, dir: Vec2, possess: boolean): void {
  if (possess && tryPossess(ctx, drone)) return; // landed — glue to the robot next tick

  const pos = drone.position;
  const step = gameConfig.drone.speed * dt;
  pos.x = clamp(pos.x + dir.x * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + dir.y * step, 0, worldPixelSize.height);
  if (dir.x !== 0 || dir.y !== 0) drone.heading = Math.atan2(dir.y, dir.x);
}

/** Lands on the nearest idle friendly robot within range; returns whether it did. */
function tryPossess(ctx: GameContext, drone: DroneEntity): boolean {
  const pos = drone.position;
  const idle = robots(ctx.world).entities.filter(
    (r) =>
      r.owner === drone.owner &&
      isAlive(r) &&
      !isDisabled(r) && // nothing to steer: its controls are down
      r.script.programId === TaskType.Idle &&
      distance(pos.x, pos.y, r.position.x, r.position.y) <= gameConfig.drone.possessRadius,
  );
  const target = nearest(pos, idle);
  if (!target) return false;
  drone.drone.possessedId = target.id;
  return true;
}

/** While possessing: release, or steer + fire the robot; the drone rides along. */
function drivePossessed(
  ctx: GameContext,
  dt: number,
  drone: DroneEntity,
  robot: RobotEntity,
  dir: Vec2,
  release: boolean,
  fire: boolean,
): void {
  const rpos = robot.position;

  if (release) {
    drone.drone.possessedId = undefined;
  } else if (isDisabled(robot)) {
    // Knocked out under the pilot: the drone keeps riding (and can still bail
    // out with `release`), but the hull answers neither the stick nor the trigger.
    robot.targetId = undefined;
  } else {
    // Manual-only fire: never let the Idle-under-fire resolver auto-fire this robot.
    robot.targetId = undefined;
    const speed = robot.movement.speed;
    stepWithWalls(ctx, robot, dir, speed * dt);
    if (dir.x !== 0 || dir.y !== 0) robot.heading = Math.atan2(dir.y, dir.x);
    if (fire) fireManual(ctx, robot);
  }

  // The drone hovers on whatever robot it's riding (or its last spot on release).
  drone.position.x = rpos.x;
  drone.position.y = rpos.y;
}

/** Direct, obstacle-checked step (per-axis, so it slides along walls). */
function stepWithWalls(ctx: GameContext, robot: Positioned, dir: Vec2, dist: number): void {
  const pos = robot.position;
  if (dir.x !== 0) {
    const nx = clamp(pos.x + dir.x * dist, 0, worldPixelSize.width);
    if (!blockedAt(ctx, nx, pos.y)) pos.x = nx;
  }
  if (dir.y !== 0) {
    const ny = clamp(pos.y + dir.y * dist, 0, worldPixelSize.height);
    if (!blockedAt(ctx, pos.x, ny)) pos.y = ny;
  }
}

function blockedAt(ctx: GameContext, x: number, y: number): boolean {
  const { tx, ty } = tileOf({ x, y });
  return isBlockedGrid(ctx.navObstacles, tx, ty);
}

/**
 * Fires the possessed robot's weapon once: kamikaze detonates, a launcher sends a
 * salvo, others shoot the nearest foe in range.
 *
 * A launcher picks its target by a different rule from everything else here, and
 * has to: its range spans the map, so "nearest in range" would mean "nearest on
 * the map" and the pilot would be firing blind at the far corner. It gets the
 * nearest foe the side can actually *see* and whose distance its drones can
 * actually cover — the same two gates automatic fire goes through (`isKnownTo`,
 * `withinMunitionReach`), just applied at selection rather than after it.
 */
function fireManual(ctx: GameContext, robot: RobotEntity): void {
  const w = robot.weapon;
  if (isDisabled(robot)) return;
  if (w.explosionRadius > 0) {
    detonateBomb(ctx, robot); // kamikaze: blast on demand, self-destruct
    return;
  }
  if (!canEngage(w) || w.cooldownLeft > 0) return;

  const pos = robot.position;
  const foes = [...enemyRobots(ctx, robot.owner), ...enemyBases(ctx, robot.owner)].filter((e) =>
    w.salvo > 0
      ? isKnownTo(ctx, robot.owner, e) && withinMunitionReach(pos, e)
      : distance(pos.x, pos.y, e.position.x, e.position.y) <= w.range,
  );
  const target = nearest(pos, foes);
  if (!target) return;

  if (w.salvo > 0) launchSalvo(ctx, robot, target);
  else spawnProjectile(ctx.world, robot.owner, pos, target.position, target.id, w.damage, robot.id, robot.weaponType);
  w.cooldownLeft = w.cooldown;
  ctx.bus.emit('projectileFired', { owner: robot.owner, pos: { x: pos.x, y: pos.y }, weapon: robot.weaponType });
}

function normalize(v: Vec2): Vec2 {
  const len = vecLength(v.x, v.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
