import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { getProgram } from '../../config/programs';
import type { Vec2 } from '../../types/entities';
import { RobotState } from '../../types/enums';
import type { BehaviorAction, BehaviorCondition } from '../../types/tasks';
import { clamp, distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { hasLineOfSight, tileCentre, tileOf } from '../obstacles';
import { nearestFreeTile } from '../pathfinding';
import { clearGoal, setGoal } from './movement';
import { findById, isEnemy, knownEnemyBases, knownEnemyRobots, nearest } from './targeting';

/**
 * Behaviour resolver. Each robot runs a priority-ordered directive program
 * (see config/programs.ts). Every tick we walk its directives top-down and take
 * the first *move* intent and the first *fire* intent independently — so a robot
 * can dodge (move) while returning fire (fire) at the same time. Movement/combat
 * systems act on the resulting goal + `targetId` afterwards.
 */
export function taskSystem(ctx: GameContext, dt: number): void {
  for (const e of ctx.world.with('robot', 'position', 'script', 'movement')) {
    if (e.threat && e.threat.underFireLeft > 0) {
      e.threat.underFireLeft = Math.max(0, e.threat.underFireLeft - dt);
    }
    runProgram(ctx, e);
  }
}

type MoveIntent = { kind: 'goal'; x: number; y: number } | { kind: 'hold' };
interface Outcome {
  move?: MoveIntent;
  fire?: string;
}

function runProgram(ctx: GameContext, e: Entity): void {
  const program = getProgram(e.script!.programId);

  let move: MoveIntent | undefined;
  let fire: string | undefined;
  let fireSet = false;

  for (const directive of program.directives) {
    if (move && fireSet) break;
    if (!conditionHolds(ctx, e, directive.when)) continue;
    const out = resolveAction(ctx, e, directive.do);
    if (!move && out.move) move = out.move;
    if (!fireSet && out.fire !== undefined) {
      fire = out.fire;
      fireSet = true;
    }
  }

  if (move?.kind === 'goal') {
    setGoal(ctx, e, move.x, move.y); // movement system sets the Moving state
  } else if (move?.kind === 'hold') {
    clearGoal(e);
    e.movement!.state = fire ? RobotState.Attacking : RobotState.Idle;
  }
  // move === undefined → no autonomous move intent: leave the current goal
  // untouched so a manually issued destination (right-click) is obeyed.
  e.targetId = fire;
}

function conditionHolds(ctx: GameContext, e: Entity, cond: BehaviorCondition): boolean {
  switch (cond.type) {
    case 'always':
      return true;
    case 'underFire':
      return (e.threat?.underFireLeft ?? 0) > 0;
    case 'enemyRobotsExist':
      return knownEnemyRobots(ctx, e.owner!).length > 0;
    case 'enemyBasesExist':
      return knownEnemyBases(ctx, e.owner!).length > 0;
    case 'enemyRobotWithin': {
      const range = cond.range ?? e.weapon?.range ?? 0;
      if (range <= 0) return false;
      const foe = nearest(e.position!, knownEnemyRobots(ctx, e.owner!));
      return (
        !!foe?.position &&
        distance(e.position!.x, e.position!.y, foe.position.x, foe.position.y) <= range
      );
    }
  }
}

function resolveAction(ctx: GameContext, e: Entity, action: BehaviorAction): Outcome {
  switch (action.type) {
    case 'idle':
      // No autonomous intent — obey manual goals, coast to a standing destination.
      return {};
    case 'guard':
      return guardOutcome(ctx, e);
    case 'search':
      return searchOutcome(ctx, e);
    case 'evade':
      return evadeOutcome(ctx, e);
    case 'attackAttacker':
      return attackAttackerOutcome(ctx, e);
    case 'attackNearestRobot': {
      const target = nearest(e.position!, knownEnemyRobots(ctx, e.owner!));
      return target ? engageOutcome(ctx, e, target) : {};
    }
    case 'attackNearestBase': {
      const target = nearest(e.position!, knownEnemyBases(ctx, e.owner!));
      return target ? engageOutcome(ctx, e, target) : {};
    }
    case 'attackTarget':
      return attackTargetOutcome(ctx, e);
  }
}

/** Focus-fire the specific ordered target (robot or base); hold once it's gone. */
function attackTargetOutcome(ctx: GameContext, e: Entity): Outcome {
  const id = e.script!.blackboard.attackTargetId;
  const target = id ? findById(ctx, id) : undefined;
  if (!target || (target.hp ?? 0) <= 0 || !target.position || !isEnemy(e.owner, target.owner)) {
    return { move: { kind: 'hold' } }; // target destroyed/invalid — stop and defend
  }
  return engageOutcome(ctx, e, target);
}

/** Approach a target, stopping to fire once in weapon range with line of sight. */
function engageOutcome(ctx: GameContext, e: Entity, target: Entity): Outcome {
  const pos = e.position!;
  const tp = target.position!;
  const range = e.weapon?.range ?? 0;
  const d = distance(pos.x, pos.y, tp.x, tp.y);

  if (range <= 0) {
    // Unarmed: close to a stand-off distance so it doesn't jam the target.
    if (d > gameConfig.combat.unarmedStandoff) return { move: { kind: 'goal', x: tp.x, y: tp.y } };
    return { move: { kind: 'hold' } };
  }
  if (d <= range && hasLineOfSight(ctx.obstacles, pos, tp)) {
    return { move: { kind: 'hold' }, fire: target.id };
  }
  return { move: { kind: 'goal', x: tp.x, y: tp.y }, fire: target.id };
}

/** Fire-only: shoot back at the last attacker if it's still a valid target. */
function attackAttackerOutcome(ctx: GameContext, e: Entity): Outcome {
  const id = e.threat?.attackerId;
  if (!id) return {};
  const attacker = findById(ctx, id);
  if (!attacker || (attacker.hp ?? 0) <= 0 || !attacker.position) return {};
  return { fire: attacker.id };
}

/** Move-only: strafe perpendicular to incoming fire to dodge. */
function evadeOutcome(ctx: GameContext, e: Entity): Outcome {
  const pos = e.position!;
  const attackerId = e.threat?.attackerId;
  const attacker = attackerId ? findById(ctx, attackerId) : undefined;
  const from =
    attacker && (attacker.hp ?? 0) > 0 && attacker.position
      ? attacker.position
      : nearest(pos, knownEnemyRobots(ctx, e.owner!))?.position;
  if (!from) return {}; // nothing to dodge — let a lower-priority directive move us

  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular to the line of fire; side chosen deterministically per robot.
  let px = -dy / len;
  let py = dx / len;
  if (evadeSide(e.id) < 0) {
    px = -px;
    py = -py;
  }
  const dist = gameConfig.behavior.evadeDistance;
  return {
    move: {
      kind: 'goal',
      x: clamp(pos.x + px * dist, 0, worldPixelSize.width),
      y: clamp(pos.y + py * dist, 0, worldPixelSize.height),
    },
  };
}

/** Move-only: roam toward a random spot, picking a new one on arrival. */
function searchOutcome(ctx: GameContext, e: Entity): Outcome {
  return roamOutcome(e, () => randomSearchPoint(ctx));
}

/** Shared roam loop: walk to `blackboard.roamTarget`, picking a fresh one (via `pickPoint`) on arrival. */
function roamOutcome(e: Entity, pickPoint: () => Vec2): Outcome {
  const pos = e.position!;
  const bb = e.script!.blackboard;
  const target = bb.roamTarget;
  if (!target || distance(pos.x, pos.y, target.x, target.y) <= gameConfig.robots.arrivalThreshold) {
    bb.roamTarget = pickPoint();
  }
  const goal = bb.roamTarget!;
  return { move: { kind: 'goal', x: goal.x, y: goal.y } };
}

function randomSearchPoint(ctx: GameContext): Vec2 {
  const { width, height } = gameConfig.grid;
  const tx = Math.floor(ctx.rng.next() * width);
  const ty = Math.floor(ctx.rng.next() * height);
  const free = nearestFreeTile(ctx.obstacles, tx, ty);
  return tileCentre(free.tx, free.ty);
}

/** A random reachable point within `radius` px of `centre` (clamped to the map). */
function randomPointNear(ctx: GameContext, centre: Vec2, radius: number): Vec2 {
  const angle = ctx.rng.next() * Math.PI * 2;
  const dist = ctx.rng.next() * radius;
  const x = clamp(centre.x + Math.cos(angle) * dist, 0, worldPixelSize.width);
  const y = clamp(centre.y + Math.sin(angle) * dist, 0, worldPixelSize.height);
  const tile = tileOf({ x, y });
  const free = nearestFreeTile(ctx.obstacles, tile.tx, tile.ty);
  return tileCentre(free.tx, free.ty);
}

/**
 * Perimeter defence: patrol a random point within `guardPatrolRadius` of the
 * guard post (like `search`, but bounded near base) rather than standing
 * still, engaging anything that comes within weapon range along the way.
 */
function guardOutcome(ctx: GameContext, e: Entity): Outcome {
  const pos = e.position!;
  const range = e.weapon?.range ?? 0;
  const post = e.script!.blackboard.guardPos;

  if (range > 0) {
    const foe = nearest(pos, knownEnemyRobots(ctx, e.owner!));
    if (
      foe?.position &&
      distance(pos.x, pos.y, foe.position.x, foe.position.y) <= range &&
      hasLineOfSight(ctx.obstacles, pos, foe.position)
    ) {
      return { move: { kind: 'hold' }, fire: foe.id };
    }
  }
  if (!post) return { move: { kind: 'hold' } };
  return roamOutcome(e, () => randomPointNear(ctx, post, gameConfig.behavior.guardPatrolRadius));
}

/** Stable per-robot dodge side so a robot doesn't jitter between the two. */
function evadeSide(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}
