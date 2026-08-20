import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { RobotState, TaskType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../utils/math';
import type { BaseEntity, Navigable, RobotEntity } from '../ecs/archetypes';
import { isAlive } from '../ecs/guards';
import { bases, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { tileOf } from '../obstacles';
import { findPath, smoothPath } from '../pathfinding';
import { steerAround } from './avoidance';
import { isDisabled } from './status';
import { baseFootprintContains } from './targeting';

/**
 * Sets a robot's navigation goal, pathfinding around obstacles. Skips the A*
 * recompute when the goal is still in the same tile (tasks re-issue every tick).
 *
 * The route is string-pulled before it is stored: `findPath` walks tile centres,
 * so an unsmoothed diagonal is a staircase that swings half a tile either side of
 * the line the robot wants, and every zag is another obstacle edge to drive into.
 * The formation frame has had this since `9e47bbc`; this is the same pass for a
 * robot's own path (`.docs/tasks/local-avoidance.md`, stage 1).
 *
 * The corridor it demands is exactly hull width, and that was measured rather
 * than assumed: a smoothed leg is only valid from where it was computed — unlike
 * the staircase it replaces it does not run through free tile *centres* — so a
 * wider margin to absorb sideways shove looks like the safer choice. A sweep over
 * eight seeded maps (hull width, 1.5x, 2x, 2.5x, and no smoothing at all) found
 * plain hull width the best of them and the rest non-monotonic, i.e. noise rather
 * than a curve. Widen it only with a measurement that says which population it
 * helps.
 *
 * A robot shoved inside a base footprint needs no special case here: `findPath`
 * prefixes its route with a hop out to the nearest free tile, and `hasClearance`
 * samples the anchor itself first — from inside rock that fails for every
 * candidate, so the hop is always kept and only the tail is straightened.
 */
export function setGoal(ctx: GameContext, entity: Navigable, x: number, y: number): void {
  const m = entity.movement;
  const goalTile = tileOf({ x, y });
  // The cache needs a *route*, not just a goal. A robot whose `findPath` came
  // back empty keeps its goal with no destination, and matching on the goal tile
  // alone made that permanent: the task layer re-issues the same goal every tick,
  // this returns early every tick, and the robot retreats forever without ever
  // asking again — even after the retreat has moved it somewhere a route exists.
  if (m.goal && m.destination) {
    const prev = tileOf(m.goal);
    if (prev.tx === goalTile.tx && prev.ty === goalTile.ty) return;
  }
  const raw = findPath(ctx.navObstacles, entity.position, { x, y });
  const path = smoothPath(ctx.navObstacles, entity.position, raw, gameConfig.robots.radius);
  m.goal = { x, y };
  m.path = path;
  m.destination = path.length > 0 ? path[0] : undefined;
  if (!m.destination) m.state = RobotState.Idle;
}

/** Cancels navigation (used when a robot stops to engage). */
export function clearGoal(entity: Navigable): void {
  const m = entity.movement;
  m.goal = undefined;
  m.path = undefined;
  m.destination = undefined;
}

/** Advances every robot along its path for one simulation step. */
export function movementSystem(ctx: GameContext, dt: number): void {
  const list = robots(ctx.world).entities;

  for (const e of robots(ctx.world)) {
    const m = e.movement;

    // Knocked out by a directed-energy hit: it doesn't drive. The anti-jam
    // bookkeeping is kept current anyway — left stale, standing still for eight
    // seconds would read as a jam and send the robot into a retreat the instant
    // it recovers. Separation still shoves it around, on purpose: a frozen
    // cluster must not become a wall its own side has to path around.
    if (isDisabled(e)) {
      m.prevX = e.position.x;
      m.prevY = e.position.y;
      m.stuckTime = 0;
      m.retreatTime = 0;
      m.state = RobotState.Idle;
      continue;
    }

    // Net progress is measured over a *full* tick: compare the start-of-tick
    // position against last tick's start (which folds in the robot's own
    // movement plus any separation push). Recording it post-move would only
    // capture the separation gap and flag freely-moving robots as stuck.
    const startX = e.position.x;
    const startY = e.position.y;

    if ((m.retreatTime ?? 0) <= 0) maybeStartRetreat(ctx, e, dt);
    if ((m.retreatTime ?? 0) > 0) retreatStep(e, dt);
    else moveEntity(e, list, dt);

    m.prevX = startX;
    m.prevY = startY;
  }
}

/**
 * Detects a jam and starts a retreat: a robot that wants to move (has a goal) or
 * is trapped inside a base, yet made ~no net progress since last tick, backs off
 * for `retreatSeconds` — driving back the way it came (or straight out of a
 * base) — then re-approaches. Legitimately-holding units (no goal, not in a
 * base) and parked idle ones are left alone.
 */
function maybeStartRetreat(ctx: GameContext, e: RobotEntity, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  // A parked idle robot must not jitter — but one that has been *sent* somewhere
  // (a right-click move, or a rally point out of the factory) may jam like any
  // other, and a whole production run funnelling through the same door makes
  // that systematic rather than occasional.
  if (e.script.programId === TaskType.Idle && !m.goal) {
    m.stuckTime = 0;
    return;
  }
  const base = baseContaining(ctx, pos);
  if (!m.goal && !base) {
    m.stuckTime = 0;
    return;
  }

  // All but arrived, and merely being jostled by whoever else is standing here:
  // that is not a jam. Backing such a robot out is actively wrong once formations
  // exist — the thing pinning it is its own side closing up around it, and the
  // retreat would drive it out of the line it just spent the march reaching. A
  // real jam is a robot with somewhere far to be and no way to get there, which
  // this leaves untouched.
  //
  // Measured against the end of the *route*, not the goal that was asked for.
  // `findPath` snaps a goal inside rock or a base footprint out to the nearest
  // free tile, and that tile is often the one the robot is already standing on:
  // the route is then a single waypoint at its own feet, it "arrives" without
  // moving, and the unreachable remainder — a whole tile of it — was being
  // charged to it as stagnation. That was every retreat left after unit
  // avoidance landed: 406 of 406 fired at a robot that had held its goal for
  // exactly zero consecutive ticks, because it reached the end of its route
  // every single tick. See `.docs/tasks/local-avoidance.md`.
  const settling = gameConfig.robots.radius * 2;
  const route = m.path && m.path.length > 0 ? m.path[m.path.length - 1] : m.goal;
  if (route && distance(pos.x, pos.y, route.x, route.y) <= settling) {
    m.stuckTime = 0;
    return;
  }

  const moved = m.prevX !== undefined ? vecLength(pos.x - m.prevX, pos.y - (m.prevY ?? pos.y)) : Infinity;
  if (moved >= gameConfig.behavior.stuckEpsilon) {
    m.stuckTime = 0;
    return;
  }

  m.stuckTime = (m.stuckTime ?? 0) + dt;
  if (m.stuckTime < gameConfig.behavior.stuckAfter) return;
  m.stuckTime = 0;

  // Retreat: straight out of a base when trapped, else back the way it came.
  m.retreatAngle = base ? Math.atan2(pos.y - base.position.y, pos.x - base.position.x) : e.heading + Math.PI;
  m.retreatTime = gameConfig.behavior.retreatSeconds;
}

/** Drives the robot along its retreat direction at full speed for one step. */
function retreatStep(e: RobotEntity, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const ang = m.retreatAngle ?? 0;
  const step = m.speed * dt;
  pos.x = clamp(pos.x + Math.cos(ang) * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + Math.sin(ang) * step, 0, worldPixelSize.height);
  e.heading = ang;
  m.state = RobotState.Moving;
  m.retreatTime = (m.retreatTime ?? 0) - dt;
}

/** The living base whose footprint contains `p`, or undefined. */
function baseContaining(ctx: GameContext, p: Vec2): BaseEntity | undefined {
  return bases(ctx.world).entities.find((b) => isAlive(b) && baseFootprintContains(b, p));
}

function moveEntity(e: RobotEntity, neighbours: readonly RobotEntity[], dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const dest = m.destination;
  if (!dest) return;

  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const dist = vecLength(dx, dy);
  e.heading = Math.atan2(dy, dx);

  const step = m.speed * dt;
  if (dist > gameConfig.robots.arrivalThreshold && step < dist) {
    // Step around a neighbour rather than into one. Only on a full step: the
    // arrival branch below has to be allowed to land exactly on its waypoint, or
    // the "he's arrived" tolerances the formation layer is built on start
    // disagreeing with where robots actually stop.
    const steered = steerAround(e, neighbours, e.heading, step);
    if (steered !== undefined) e.heading = steered;
    pos.x += Math.cos(e.heading) * step;
    pos.y += Math.sin(e.heading) * step;
    m.state = RobotState.Moving;
    return;
  }

  pos.x = dest.x;
  pos.y = dest.y;
  if (m.path && m.path.length > 1) {
    m.path.shift();
    m.destination = m.path[0];
    m.state = RobotState.Moving;
  } else {
    m.path = undefined;
    m.goal = undefined;
    m.destination = undefined;
    m.state = RobotState.Idle;
  }
}
