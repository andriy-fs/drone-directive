import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { TaskType } from '../../types/enums';
import { clamp, distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import { spawnProjectile } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { isBlockedGrid, tileOf } from '../obstacles';
import { detonateBomb } from './combat';
import { enemyBases, enemyRobots, findById, nearest } from './targeting';

/**
 * The player's observer drone. It free-flies ignoring obstacles (it never
 * pathfinds), and can land on an idle friendly robot to possess it — then it
 * steers that robot directly (obstacle-checked, so the robot still stops at
 * walls) and fires/detonates its weapon on demand (fully manual — no auto-fire).
 *
 * Runs after `taskSystem` so it can override the target the Idle resolver set,
 * keeping a possessed robot's fire strictly manual. Driven entirely by
 * `ctx.droneControl`, which the app bridge fills from player input each step.
 */
export function droneSystem(ctx: GameContext, dt: number): void {
  const drone = ctx.world.with('drone', 'position').entities[0];
  if (!drone?.drone || !drone.position) return;

  const control = ctx.droneControl;
  const dir = normalize(control.dir);

  const possessed = drone.drone.possessedId ? findById(ctx, drone.drone.possessedId) : undefined;
  const robot = possessed?.robot && (possessed.hp ?? 0) > 0 ? possessed : undefined;

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
function freeFly(ctx: GameContext, dt: number, drone: Entity, dir: Vec2, possess: boolean): void {
  if (possess && tryPossess(ctx, drone)) return; // landed — glue to the robot next tick

  const pos = drone.position!;
  const step = gameConfig.drone.speed * dt;
  pos.x = clamp(pos.x + dir.x * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + dir.y * step, 0, worldPixelSize.height);
  if (dir.x !== 0 || dir.y !== 0) drone.heading = Math.atan2(dir.y, dir.x);
}

/** Lands on the nearest idle friendly robot within range; returns whether it did. */
function tryPossess(ctx: GameContext, drone: Entity): boolean {
  const pos = drone.position!;
  const idle = ctx.world
    .with('robot', 'position')
    .entities.filter(
      (r) =>
        r.owner === drone.owner &&
        (r.hp ?? 0) > 0 &&
        r.script?.programId === TaskType.Idle &&
        distance(pos.x, pos.y, r.position!.x, r.position!.y) <= gameConfig.drone.possessRadius,
    );
  const target = nearest(pos, idle);
  if (!target) return false;
  drone.drone!.possessedId = target.id;
  return true;
}

/** While possessing: release, or steer + fire the robot; the drone rides along. */
function drivePossessed(
  ctx: GameContext,
  dt: number,
  drone: Entity,
  robot: Entity,
  dir: Vec2,
  release: boolean,
  fire: boolean,
): void {
  const rpos = robot.position!;

  if (release) {
    drone.drone!.possessedId = undefined;
  } else {
    // Manual-only fire: never let the Idle-under-fire resolver auto-fire this robot.
    robot.targetId = undefined;
    const speed = robot.movement?.speed ?? gameConfig.drone.speed;
    stepWithWalls(ctx, robot, dir, speed * dt);
    if (dir.x !== 0 || dir.y !== 0) robot.heading = Math.atan2(dir.y, dir.x);
    if (fire) fireManual(ctx, robot);
  }

  // The drone hovers on whatever robot it's riding (or its last spot on release).
  drone.position!.x = rpos.x;
  drone.position!.y = rpos.y;
}

/** Direct, obstacle-checked step (per-axis, so it slides along walls). */
function stepWithWalls(ctx: GameContext, robot: Entity, dir: Vec2, dist: number): void {
  const pos = robot.position!;
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

/** Fires the possessed robot's weapon once: kamikaze detonates, others shoot the nearest foe in range. */
function fireManual(ctx: GameContext, robot: Entity): void {
  const w = robot.weapon;
  if (!w) return;
  if (w.explosionRadius > 0) {
    detonateBomb(ctx, robot); // kamikaze: blast on demand, self-destruct
    return;
  }
  if (w.range <= 0 || w.damage <= 0 || w.cooldownLeft > 0) return;

  const pos = robot.position!;
  const foes = [...enemyRobots(ctx, robot.owner!), ...enemyBases(ctx, robot.owner!)].filter(
    (e) => distance(pos.x, pos.y, e.position!.x, e.position!.y) <= w.range,
  );
  const target = nearest(pos, foes);
  if (!target?.position) return;

  spawnProjectile(ctx.world, robot.owner!, pos, target.position, target.id, w.damage, robot.id, robot.weaponType!);
  w.cooldownLeft = w.cooldown;
  ctx.bus.emit('projectileFired', { owner: robot.owner!, pos: { x: pos.x, y: pos.y }, weapon: robot.weaponType! });
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
