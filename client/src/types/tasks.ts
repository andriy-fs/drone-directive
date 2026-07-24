import type { Vec2 } from './entities';
import type { TaskType } from './enums';

/**
 * Robot behaviour is a **priority-ordered list of directives** ("when → do"),
 * evaluated top-down every tick: the first directive that yields a *move* wins
 * the move intent, the first that yields a *fire* wins the fire intent (the two
 * are independent, so a robot can dodge while returning fire). Reactive rules
 * sit on top; the primary goal is the `always` fallback at the bottom.
 *
 * A named directive list is a `Program` — the JSON-describable robot scenario.
 * Programs are keyed by `TaskType` (the id the UI/settings choose).
 */

/** Guard: when a directive applies. */
export type BehaviorCondition =
  | { type: 'always' }
  /** Recently hit (within the under-fire window). */
  | { type: 'underFire' }
  /** A *known* (detected) enemy robot is within `range` px (default: weapon range). */
  | { type: 'enemyRobotWithin'; range?: number }
  /** Any *known* (detected by this robot's team) enemy robot exists. */
  | { type: 'enemyRobotsExist' }
  /** Any *known* (detected by this robot's team) enemy base exists. */
  | { type: 'enemyBasesExist' };

/** Action: what a matching directive makes the robot do (may set move, fire, or both). */
export type BehaviorAction =
  /** Approach + engage the nearest enemy robot (stops in range/LOS to fire). */
  | { type: 'attackNearestRobot' }
  /** Approach + engage the nearest enemy base. */
  | { type: 'attackNearestBase' }
  /** Fire at whoever last hit us (fire-only; no move) — the return-fire reaction. */
  | { type: 'attackAttacker' }
  /** Strafe perpendicular to incoming fire (move-only) — the dodge reaction. */
  | { type: 'evade' }
  /** Patrol near a post (perimeter defence), engaging enemies that come into range without chasing far. */
  | { type: 'guard' }
  /** Roam looking for enemies (move-only) — used when nothing is known yet. */
  | { type: 'search' }
  /** Approach + engage the specific ordered target in `blackboard.attackTargetId`. */
  | { type: 'attackTarget' }
  /** Do nothing (hold position, no target). */
  | { type: 'idle' };

/** One rule in a program: apply `do` when `when` holds. */
export interface Directive {
  when: BehaviorCondition;
  do: BehaviorAction;
}

/** A named, ordered behaviour program — the robot "scenario", describable as JSON. */
export interface Program {
  id: TaskType;
  label: string;
  directives: Directive[];
}

/**
 * A robot's live behaviour: which program it runs plus per-robot runtime memory
 * (blackboard) the directives read/write. The directive list itself lives in the
 * program registry, keyed by `programId`, so scripts stay small and serialisable.
 */
export interface RobotScript {
  programId: TaskType;
  blackboard: {
    /** Guard: the post to patrol around (robot's position when the program was assigned). */
    guardPos?: Vec2;
    /** Search/Guard: the current roam waypoint (picked fresh once reached). */
    roamTarget?: Vec2;
    /** AttackTarget: id of the specific enemy (robot or base) this robot was ordered to attack. */
    attackTargetId?: string;
  };
}
