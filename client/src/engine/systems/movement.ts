import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { RobotState, TaskType } from '../../types/enums';
import { clamp } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { tileOf } from '../obstacles';
import { findPath } from '../pathfinding';

/**
 * Sets a robot's navigation goal, pathfinding around obstacles. Skips the A*
 * recompute when the goal is still in the same tile (tasks re-issue every tick).
 */
export function setGoal(ctx: GameContext, entity: Entity, x: number, y: number): void {
  const m = entity.movement;
  if (!m || !entity.position) return;
  const goalTile = tileOf({ x, y });
  if (m.goal) {
    const prev = tileOf(m.goal);
    if (prev.tx === goalTile.tx && prev.ty === goalTile.ty) return;
  }
  const path = findPath(ctx.navObstacles, entity.position, { x, y });
  m.goal = { x, y };
  m.path = path;
  m.destination = path.length > 0 ? path[0] : undefined;
  if (!m.destination) m.state = RobotState.Idle;
}

/** Cancels navigation (used when a robot stops to engage). */
export function clearGoal(entity: Entity): void {
  const m = entity.movement;
  if (!m) return;
  m.goal = undefined;
  m.path = undefined;
  m.destination = undefined;
}

/** Advances every robot along its path for one simulation step. */
export function movementSystem(ctx: GameContext, dt: number): void {
  for (const e of ctx.world.with('robot', 'position', 'movement')) {
    const m = e.movement!;
    // Net progress is measured over a *full* tick: compare the start-of-tick
    // position against last tick's start (which folds in the robot's own
    // movement plus any separation push). Recording it post-move would only
    // capture the separation gap and flag freely-moving robots as stuck.
    const startX = e.position!.x;
    const startY = e.position!.y;

    if ((m.retreatTime ?? 0) <= 0) maybeStartRetreat(ctx, e, dt);
    if ((m.retreatTime ?? 0) > 0) retreatStep(e, dt);
    else moveEntity(e, dt);

    m.prevX = startX;
    m.prevY = startY;
  }
}

/**
 * Detects a jam and starts a retreat: a robot with a non-idle program that wants
 * to move (has a goal) or is trapped inside a base, yet made ~no net progress
 * since last tick, backs off for `retreatSeconds` — driving back the way it came
 * (or straight out of a base) — then re-approaches. Legitimately-holding units
 * (no goal, not in a base) and idle units are left alone.
 */
function maybeStartRetreat(ctx: GameContext, e: Entity, dt: number): void {
  const m = e.movement!;
  const pos = e.position!;
  if (e.script?.programId === TaskType.Idle) {
    m.stuckTime = 0;
    return;
  }
  const base = baseContaining(ctx, pos);
  if (!m.goal && !base) {
    m.stuckTime = 0;
    return;
  }

  const moved = m.prevX !== undefined ? Math.hypot(pos.x - m.prevX, pos.y - (m.prevY ?? pos.y)) : Infinity;
  if (moved >= gameConfig.behavior.stuckEpsilon) {
    m.stuckTime = 0;
    return;
  }

  m.stuckTime = (m.stuckTime ?? 0) + dt;
  if (m.stuckTime < gameConfig.behavior.stuckAfter) return;
  m.stuckTime = 0;

  // Retreat: straight out of a base when trapped, else back the way it came.
  m.retreatAngle = base ? Math.atan2(pos.y - base.position!.y, pos.x - base.position!.x) : (e.heading ?? 0) + Math.PI;
  m.retreatTime = gameConfig.behavior.retreatSeconds;
}

/** Drives the robot along its retreat direction at full speed for one step. */
function retreatStep(e: Entity, dt: number): void {
  const m = e.movement!;
  const pos = e.position!;
  const ang = m.retreatAngle ?? 0;
  const step = m.speed * dt;
  pos.x = clamp(pos.x + Math.cos(ang) * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + Math.sin(ang) * step, 0, worldPixelSize.height);
  e.heading = ang;
  m.state = RobotState.Moving;
  m.retreatTime = (m.retreatTime ?? 0) - dt;
}

/** The living base whose footprint contains `p`, or undefined. */
function baseContaining(ctx: GameContext, p: Vec2): Entity | undefined {
  const { tilePx } = gameConfig.grid;
  return ctx.world.with('base', 'position').entities.find((b) => {
    if ((b.hp ?? 0) <= 0) return false;
    const half = ((b.footprint ?? gameConfig.bases.footprintTiles) * tilePx) / 2;
    return Math.abs(p.x - b.position!.x) <= half && Math.abs(p.y - b.position!.y) <= half;
  });
}

function moveEntity(e: Entity, dt: number): void {
  const m = e.movement!;
  const pos = e.position!;
  const dest = m.destination;
  if (!dest) return;

  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const dist = Math.hypot(dx, dy);
  e.heading = Math.atan2(dy, dx);

  const step = m.speed * dt;
  if (dist > gameConfig.robots.arrivalThreshold && step < dist) {
    pos.x += (dx / dist) * step;
    pos.y += (dy / dist) * step;
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
