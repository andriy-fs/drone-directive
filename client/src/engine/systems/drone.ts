import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { TaskType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../utils/math';
import type { BaseEntity, DroneEntity, Positioned, RobotEntity } from '../ecs/archetypes';
import { spawnProjectile } from '../ecs/factory';
import { isAlive } from '../ecs/guards';
import { drones, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { isBlockedGrid, tileOf } from '../obstacles';
import { canEngage, detonateBomb, launchSalvo, withinMunitionReach } from './combat';
import { clearGoal } from './movement';
import { isDisabled } from '../status';
import { enemyBases, enemyRobots, isKnownTo, livingRobotById, nearest } from '../targeting';

/**
 * Observer-drone flight. A drone free-flies ignoring obstacles (it never
 * pathfinds), and can land on an idle friendly robot to possess it — then it
 * steers that robot directly (obstacle-checked, so the robot still stops at
 * walls) and fires/detonates its weapon on demand (fully manual — no auto-fire).
 * The stick is read differently once it is riding a hull — see `drivePossessed`.
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

  const possessedId = drone.drone.possessedId;
  const robot = possessedId ? livingRobotById(ctx, possessedId) : undefined;

  if (robot) {
    // Raw, deliberately: while a hull is being ridden the two components are
    // *axes*, not a direction, and normalising them would rescale a half-pushed
    // throttle back up to full.
    drivePossessed(ctx, dt, drone, robot, control.dir, control.possessPulse, control.firePulse);
  } else {
    // The possessed robot is gone (e.g. a kamikaze detonated) — drop to free flight.
    drone.drone.possessedId = undefined;
    freeFly(ctx, dt, drone, steer(drone, control.dir), control.possessPulse);
  }

  control.possessPulse = false;
  control.firePulse = false;
}

/**
 * The direction a free-flying drone takes this tick — the one place its two
 * control channels meet, and the only thing that decides between them.
 *
 * Which channel a drone is on depends on who is flying it, and this system
 * deliberately cannot tell: a **bot** free-flies by the stick (`systems/aiDrone.ts`
 * writes `control.dir` toward its sweep waypoint), a **player** flies by
 * `MoveDrone` orders, and the client never sends a free-flight stick for a human
 * at all (`GameApp.localDroneControl`).
 *
 * **The stick therefore wins, and cancels the standing order.** No player can
 * currently produce that collision, but the rule has to exist and has to be this
 * way round: a stick is a hand on the controls right now, an order is a wish from
 * a second ago, and the alternative — queuing the order — would fly the machine
 * back to a stale point the instant the stick went neutral.
 *
 * Arrival clears the goal here rather than in `freeFly`, so "am I still under
 * orders" is answered in one place and a drone that has arrived reports a
 * neutral direction like any other idle one.
 */
function steer(drone: DroneEntity, stick: Vec2): Vec2 {
  const dir = normalize(stick);
  if (dir.x !== 0 || dir.y !== 0) {
    drone.drone.goal = undefined;
    return dir;
  }

  const goal = drone.drone.goal;
  if (!goal) return dir;

  const pos = drone.position;
  if (distance(pos.x, pos.y, goal.x, goal.y) <= gameConfig.drone.goalArriveRadius) {
    drone.drone.goal = undefined;
    return { x: 0, y: 0 };
  }
  return unitToward(pos, goal);
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
  // Taking the wheel spends whatever order the hull was still walking to. Idle is
  // not the same as "not en route": `taskSystem` deliberately emits no move intent
  // for an Idle robot, which is exactly what lets a right-clicked destination
  // survive — so without this the pilot steers while `movementSystem` keeps driving
  // toward the old goal in the same tick, and the machine crabs.
  clearGoal(target);
  // And the drone's own standing order with it, for the same reason: a pilot who
  // has taken a hull is no longer flying to where they sent the eye, and leaving
  // the goal on would fly it there the instant they stepped off.
  drone.drone.goal = undefined;
  drone.drone.possessedId = target.id;
  return true;
}

/**
 * While possessing: release, or steer + fire the robot; the drone rides along.
 *
 * **The stick means something different here than it does in free flight.** A
 * free-flying drone is watched from above and steered in world directions: press
 * north, fly north. A ridden hull is watched from behind its own nose
 * (`pixi/render/fpv`), where an absolute direction is the wrong instrument — the
 * key that means "forward" would move to a different finger every time the machine
 * turned. So the same `Vec2` is read as the machine's own controls: `y` is throttle
 * along the heading, `x` is a yaw *rate*, and the heading is integrated rather than
 * snapped.
 *
 * Keyed to possession rather than to which view is on screen, and that is not a
 * shortcut: the view is renderer state the simulation knows nothing about, so
 * deciding the control law by it would mean either a second field on the wire or
 * converting on the client — and a client-side conversion puts the lockstep delay
 * inside the yaw feedback loop, which wobbles. Possession is a fact both peers read
 * from the same world, so both read the stick the same way.
 */
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
    // Screen y grows downward, so `W` arrives as y = -1 and is forward.
    const throttle = -clamp(dir.y, -1, 1);
    const yaw = clamp(dir.x, -1, 1);

    // Turning is independent of driving, in both directions: the hull turns on the
    // spot with the throttle centred, and it keeps turning while pinned against a
    // wall — the step below can be refused, the heading never is. Reverse leaves
    // the heading alone, so backing out of a dead end does not spin the machine
    // (and, with the camera on its nose, does not spin the world either).
    const turnRate = (gameConfig.drone.possessTurnRateDeg * Math.PI) / 180;
    if (yaw !== 0) robot.heading = wrapAngle(robot.heading + yaw * turnRate * dt);

    const startX = rpos.x;
    const startY = rpos.y;
    const heading = { x: Math.cos(robot.heading), y: Math.sin(robot.heading) };
    if (throttle !== 0) stepWithWalls(ctx, robot, heading, robot.movement.speed * throttle * dt);
    // What the pilot just drove, in the same form `recordTick` uses — because for
    // this one hull that pass cannot measure it. `movementSystem` runs next and
    // captures its own start *after* this step, so the pilot's movement falls in
    // the gap between the two systems; left to it, a hull crossing its own
    // formation registers with ORCA as parked and its neighbours plan through it.
    // The carve-out in `movementSystem` is what stops this being overwritten.
    // Written even for a centred stick: a stale velocity is the same lie the other
    // way round.
    robot.movement.velX = (rpos.x - startX) / dt;
    robot.movement.velY = (rpos.y - startY) / dt;
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
 * **What the trigger would take**: the nearest enemy this hull's weapon can reach,
 * or nothing.
 *
 * Split out of `fireManual` so the hull view can mark it (`pixi/render/fpv`). That
 * mark is only worth anything if it is the *same* answer the trigger acts on, and
 * the alternative — the renderer working out "what looks shootable" for itself —
 * would be a second rule that agrees right up until one of the two is edited. From
 * inside a hull there is no other way to judge range: a cannon reaches 180 px, and
 * the camera already sits 118 px behind the machine, so almost everything a pilot
 * can see is out of reach and nothing on screen used to say so.
 *
 * Three cases answer "nothing" for three different reasons, and all three are
 * correct as a *mark*: a knocked-out hull answers no trigger at all, an unarmed one
 * has nothing to fire, and a kamikaze has no target because its shot is the blast
 * where it stands.
 *
 * Deliberately **ignores the cooldown**. This is what the gun is pointed at, not
 * whether it has finished reloading — and the barrel's own heat already says that
 * (`fpv/units.ts`). A mark that blinked out for every reload would read as the
 * target being lost.
 */
export function manualFireTarget(ctx: GameContext, robot: RobotEntity): RobotEntity | BaseEntity | undefined {
  const w = robot.weapon;
  if (isDisabled(robot) || w.explosionRadius > 0 || !canEngage(w)) return undefined;
  const pos = robot.position;
  const foes = [...enemyRobots(ctx, robot.owner), ...enemyBases(ctx, robot.owner)].filter((e) =>
    w.salvo > 0
      ? isKnownTo(ctx, robot.owner, e) && withinMunitionReach(pos, e)
      : distance(pos.x, pos.y, e.position.x, e.position.y) <= w.range,
  );
  return nearest(pos, foes);
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
  const target = manualFireTarget(ctx, robot);
  if (!target) return;

  if (w.salvo > 0) launchSalvo(ctx, robot, target);
  else spawnProjectile(ctx.world, robot.owner, pos, target.position, target.id, w.damage, robot.id, robot.weaponType);
  w.cooldownLeft = w.cooldown;
  ctx.bus.emit('projectileFired', { owner: robot.owner, pos: { x: pos.x, y: pos.y }, weapon: robot.weaponType, sourceId: robot.id });
}

/**
 * Back into (-pi, pi]. The heading is *accumulated* under a pilot rather than
 * derived from a vector, so without this it drifts away from the range every
 * `atan2` in the codebase produces and loses precision over a long match.
 */
function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  const wrapped = a % turn;
  if (wrapped > Math.PI) return wrapped - turn;
  if (wrapped <= -Math.PI) return wrapped + turn;
  return wrapped;
}

function normalize(v: Vec2): Vec2 {
  const len = vecLength(v.x, v.y);
  if (len < 1e-6) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Unit vector from `pos` toward `goal`, or zero once it is effectively there.
 * Shared with `systems/aiDrone.ts`: the bot's pilot flies to a waypoint by
 * exactly this construction, and two copies of it would be two chances to drift.
 */
export function unitToward(pos: Vec2, goal: Vec2): Vec2 {
  return normalize({ x: goal.x - pos.x, y: goal.y - pos.y });
}
