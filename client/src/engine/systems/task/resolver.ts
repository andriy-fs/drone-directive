import { getProgram } from '../../../config/programs';
import { RobotState } from '@drone-directive/types/enums';
import type { BehaviorAction, BehaviorCondition } from '@drone-directive/types/tasks';
import { distance } from '../../../utils/math';
import type { BaseEntity, Positioned, RobotEntity } from '../../ecs/archetypes';
import { isAlive, isPositioned } from '../../ecs/guards';
import { bases, robots } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import { hasLineOfSight } from '../../obstacles';
import { canEngage } from '../combat';
import { clearGoal, setGoal } from '../movement';
import { decayDisabled, isArming, isDisabled } from '../../status';
import {
  findById,
  knownEnemyAir,
  knownEnemyBases,
  knownEnemyRobots,
  nearest,
  pilotedHullIds,
} from '../../targeting';
import { worthShooting } from '../../threat';
import {
  attackAttackerOutcome,
  attackTargetOutcome,
  defendBaseOutcome,
  engageOutcome,
  evadeOutcome,
  groupAttackOutcome,
  guardOutcome,
  overwatchOutcome,
  retreatToBaseOutcome,
} from './outcomes';
import { applyFormations } from './formation';
import { searchOutcome } from './roam';
import type { MoveIntent, Outcome } from './types';

/**
 * Behaviour resolver. Each robot runs a priority-ordered directive program
 * (see config/programs.ts). Every tick we walk its directives top-down and take
 * the first *move* intent and the first *fire* intent independently — so a robot
 * can dodge (move) while returning fire (fire) at the same time. Movement/combat
 * systems act on the resulting goal + `targetId` afterwards. A surface-to-air
 * robot left with no fire intent at all falls back to `airTarget` — see there.
 *
 * This is also where the directed-energy knock-out ticks down, next to the
 * under-fire window. A knocked-out robot's program simply doesn't run — which is
 * what makes an order issued to it *stick* and take effect the moment it comes
 * back, since nothing here overwrites the script it was given.
 *
 * Bases get a second, much smaller pass. They have no `script` and no
 * `movement`, so they can't run a program — but their built-in battery still
 * needs a `targetId`, and this is the one place in the engine that hands one
 * out (`combat.ts` only ever consumes it).
 */
export function taskSystem(ctx: GameContext, dt: number): void {
  // Three passes rather than one, because formation keeping needs to see the
  // whole side's intents before any of them becomes a goal: where a robot should
  // stand depends on where its group is going, and that is not knowable while
  // the group is still being resolved one robot at a time.
  const resolved = new Map<string, Outcome>();
  // Resolved once for the whole side rather than per robot — the answer is fixed
  // for the tick, and `droneSystem` (which is the only writer) runs later.
  const piloted = pilotedHullIds(ctx);

  for (const e of robots(ctx.world)) {
    // Decay first, so the tick a robot recovers on is the tick it acts again —
    // identically on both peers.
    decayDisabled(e, dt);
    if (isDisabled(e)) continue;
    // A kamikaze on its lit fuse has stopped being something with a program: it
    // cannot be re-aimed, re-tasked or walked away, and `combatSystem` owns both
    // the countdown and its end. Skipped rather than resolved so nothing writes a
    // goal it will never drive to — `movement.ts` parks it on the same test.
    if (isArming(e)) continue;

    if (e.threat && e.threat.underFireLeft > 0) {
      e.threat.underFireLeft = Math.max(0, e.threat.underFireLeft - dt);
    }

    // Under a pilot: the program stands down for as long as someone is holding
    // the stick, and picks up again on release — the same deal `isDisabled` gets
    // above, and for the same reason, since nothing here overwrites the script.
    //
    // **This is what makes possessing a hull mid-march safe.** Two of the three
    // things a program does would fight the pilot rather than merely idle beside
    // them: a goal it keeps re-issuing every tick (harmless in itself, because
    // `movementSystem` skips a piloted hull, but it makes the machine walk off on
    // release toward a target the pilot never chose) and, on a kamikaze, the
    // engage outcome lighting its own fuse. That last one is the real hazard —
    // `beginArming` is committed and irreversible, `movement` parks the hull on
    // `isArming`, and the pilot loses the wheel *and* the choice of when to go up
    // at the exact moment they were driving somewhere better.
    //
    // Placed after the `underFireLeft` decay on purpose: the hull is still being
    // shot at while it is ridden, so the window has to keep ticking down, or a
    // pilot who steps off hands back a machine that thinks the fight is still on.
    if (piloted.has(e.id)) continue;

    resolved.set(e.id, runProgram(ctx, e));
  }

  applyFormations(ctx, resolved);

  for (const e of robots(ctx.world)) {
    const out = resolved.get(e.id);
    if (out) applyOutcome(ctx, e, out);
  }

  for (const b of bases(ctx.world)) {
    if (!isAlive(b)) {
      b.targetId = undefined;
      continue;
    }
    b.targetId = baseTurretTarget(ctx, b);
    const target = b.targetId ? findById(ctx, b.targetId) : undefined;
    if (target && isPositioned(target)) {
      b.heading = Math.atan2(target.position.y - b.position.y, target.position.x - b.position.x);
    }
  }
}

/**
 * What the base's built-in battery points at. **Air first**: the battery exists
 * precisely because a base could not touch an observer drone, and a ground-first
 * rule would be defeated by parking one expendable robot inside the radius. The
 * price of that priority is deliberate and accepted — while a drone is in reach
 * the battery is busy with it, so a kamikaze gets an easier run at the wall.
 *
 * Reads `known*` only, so the building is no more omniscient than a robot: its
 * 260 px sight comfortably covers the 170 px it shoots, *unless* an enemy `ew`
 * halves it to 130 — jamming a base's battery blind at the edge of its own range
 * is emergent counter-play the weapon already earns, not a special case.
 */
function baseTurretTarget(ctx: GameContext, base: BaseEntity): string | undefined {
  const w = base.weapon;
  if (!canEngage(w)) return undefined;

  const pos = base.position;
  const inReach = (e: Positioned): boolean =>
    distance(pos.x, pos.y, e.position.x, e.position.y) <= w.range &&
    hasLineOfSight(ctx.sightBlockers, pos, e.position);

  if (w.canHitAir) {
    const flyer = nearest(pos, knownEnemyAir(ctx, base.owner).filter(inReach));
    if (flyer) return flyer.id;
  }
  return nearest(pos, knownEnemyRobots(ctx, base.owner).filter(inReach))?.id;
}

/** Walks a robot's directive list and reports what it wants, without acting on it. */
function runProgram(ctx: GameContext, e: RobotEntity): Outcome {
  const program = getProgram(e.script.programId);

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

  if (!fireSet) fire = airTarget(ctx, e);

  return { move, fire };
}

/** Turns a settled intent into a goal and a target — after formations have had their say. */
function applyOutcome(ctx: GameContext, e: RobotEntity, out: Outcome): void {
  const move = out.move;
  if (move?.kind === 'goal') {
    setGoal(ctx, e, move.x, move.y); // movement system sets the Moving state
  } else if (move?.kind === 'hold') {
    clearGoal(e);
    e.movement.state = out.fire ? RobotState.Attacking : RobotState.Idle;
  }
  // move === undefined → no autonomous move intent: leave the current goal
  // untouched so a manually issued destination (right-click) is obeyed.
  e.targetId = out.fire;
}

/**
 * Last-resort anti-air: a surface-to-air robot with no ground target of its own
 * takes a shot at enemy air that has strayed into range — an observer drone, or
 * an FPV strike drone on its way in. It runs *after* the whole directive program,
 * and never contributes a move intent — a flyer outruns every chassis in the
 * game, so chasing one would only pull the robot off its actual job, and always
 * preferring air over ground targets would make flying anything impossible.
 * Opportunistic fire only.
 *
 * That "opportunistic" is exactly what a salvo is priced against: a robot busy
 * with a ground target does not stop to swat the drones coming for it, so five
 * arriving at once will mostly get through unless someone was already idle.
 */
function airTarget(ctx: GameContext, e: RobotEntity): string | undefined {
  const w = e.weapon;
  // `canEngage` rather than `damage > 0`: a `dew` hull is armed against air even
  // though it deals nothing, and its whole job here is to freeze what it cannot kill.
  if (!w.canHitAir || !canEngage(w)) return undefined;

  const pos = e.position;
  const flyer = nearest(pos, knownEnemyAir(ctx, e.owner));
  if (!flyer) return undefined;
  if (distance(pos.x, pos.y, flyer.position.x, flyer.position.y) > w.range) return undefined;
  if (!hasLineOfSight(ctx.sightBlockers, pos, flyer.position)) return undefined;
  return flyer.id;
}

function conditionHolds(ctx: GameContext, e: RobotEntity, cond: BehaviorCondition): boolean {
  switch (cond.type) {
    case 'always':
      return true;
    case 'underFire':
      return e.threat.underFireLeft > 0;
    case 'enemyRobotsExist':
      return knownEnemyRobots(ctx, e.owner).length > 0;
    case 'enemyBasesExist':
      return knownEnemyBases(ctx, e.owner).length > 0;
    case 'enemyRobotWithin': {
      const range = cond.range ?? e.weapon.range;
      if (range <= 0) return false;
      const foe = nearest(
        e.position,
        knownEnemyRobots(ctx, e.owner).filter((r) => worthShooting(ctx, e, r)),
      );
      return !!foe && distance(e.position.x, e.position.y, foe.position.x, foe.position.y) <= range;
    }
    case 'disabledEnemyWithin':
      return disabledInRange(ctx, e, cond.range) !== undefined;
  }
}

/**
 * The nearest knocked-out enemy robot standing inside `range` (default: this
 * robot's weapon range). Shared by the `disabledEnemyWithin` condition and the
 * `finishDisabled` action so the two can't drift apart.
 *
 * Only for weapons that can actually *finish* something: a `dew` gun would spend
 * its five-second reload re-freezing a target that is already frozen, which is
 * worse than holding the shot for whatever wakes up next. Same rule as
 * `worthShooting` in `targeting.ts`, expressed the other way round — this picks
 * a target *because* it's disabled, so it keeps its own `damage <= 0` check
 * rather than sharing that helper.
 */
function disabledInRange(ctx: GameContext, e: RobotEntity, range?: number): RobotEntity | undefined {
  const reach = range ?? e.weapon.range;
  if (reach <= 0 || e.weapon.damage <= 0) return undefined;
  const pos = e.position;
  const foe = nearest(
    pos,
    knownEnemyRobots(ctx, e.owner).filter((r) => isDisabled(r)),
  );
  if (!foe) return undefined;
  return distance(pos.x, pos.y, foe.position.x, foe.position.y) <= reach ? foe : undefined;
}

function resolveAction(ctx: GameContext, e: RobotEntity, action: BehaviorAction): Outcome {
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
    case 'finishDisabled': {
      // Fire-only, deliberately: a passive unit still must not chase. This says
      // only that a helpless enemy already in front of a loaded gun doesn't get
      // a free pass because it stopped shooting back.
      const target = disabledInRange(ctx, e);
      return target ? { fire: target.id } : {};
    }
    case 'attackNearestRobot': {
      const target = nearest(
        e.position,
        knownEnemyRobots(ctx, e.owner).filter((r) => worthShooting(ctx, e, r)),
      );
      return target ? engageOutcome(ctx, e, target) : {};
    }
    case 'attackNearestBase': {
      const target = nearest(
        e.position,
        knownEnemyBases(ctx, e.owner).filter((b) => worthShooting(ctx, e, b)),
      );
      return target ? engageOutcome(ctx, e, target) : {};
    }
    case 'attackTarget':
      return attackTargetOutcome(ctx, e);
    case 'retreatToBase':
      return retreatToBaseOutcome(ctx, e);
    case 'overwatch':
      return overwatchOutcome(ctx, e);
    case 'defendBase':
      return defendBaseOutcome(ctx, e, action.range);
    case 'groupAttack':
      return groupAttackOutcome(ctx, e, action.size);
  }
}
