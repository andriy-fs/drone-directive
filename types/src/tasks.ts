import type { Vec2 } from './entities';
import type { FormationType, TaskType } from './enums';

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
  /** A *known* enemy robot that is currently knocked out stands within `range` px (default: weapon range). */
  | { type: 'disabledEnemyWithin'; range?: number }
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
  /** Fire at a knocked-out enemy already inside weapon range (fire-only; never chases). */
  | { type: 'finishDisabled' }
  /** Strafe perpendicular to incoming fire (move-only) — the dodge reaction. */
  | { type: 'evade' }
  /** Patrol near a post (perimeter defence), engaging enemies that come into range without chasing far. */
  | { type: 'guard' }
  /** Roam looking for enemies (move-only) — used when nothing is known yet. */
  | { type: 'search' }
  /** Approach + engage the specific ordered target in `blackboard.attackTargetId`. */
  | { type: 'attackTarget' }
  /** Fall back toward this side's own base (move-only) — for units with nothing to fight back with. */
  | { type: 'retreatToBase' }
  /** Trail behind an advancing friendly group, or hold near base for early warning if none is advancing. */
  | { type: 'overwatch' }
  /**
   * Intercept the nearest *known* enemy robot standing within `range` px of this
   * side's **own base** (default: `behavior.defendBaseRadius`), then go back to
   * patrolling it. The trigger is proximity to the base rather than to this
   * robot, so the whole defensive line converges on one intruder.
   */
  | { type: 'defendBase'; range?: number }
  /**
   * Gather near this side's own base until `size` allies on this same directive
   * (default: `behavior.groupAttackSize`) — counting only those that have not
   * left yet — have assembled, then commit the whole group at once and advance.
   * Holds the base line (`defendBase`) while it waits.
   */
  | { type: 'groupAttack'; size?: number }
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
    /**
     * GroupAttack: the group reached strength and set off. A latch — never
     * cleared, because a wave that takes losses mid-map would otherwise drop
     * back below the threshold and turn around.
     */
    committed?: boolean;
    /**
     * The formation this robot marches in, or absent = none. Deliberately *not*
     * a slot: only the shape and which group it belongs to are remembered, and
     * the slot itself is recomputed every tick from whoever is still alive under
     * the same `gid`. Losses therefore close the ranks instead of leaving gaps,
     * and there is no stale geometry to keep in step across two peers.
     *
     * Survives a change of program — `preserveFormation` in `systems/commands.ts`
     * carries it across every order that replaces the script wholesale.
     */
    formation?: RobotFormation;
    /**
     * The group's marching route, cached on whichever member is currently the
     * *guide* (first in marching order). See `formationRouteFor` in
     * `engine/systems/task/formation.ts`.
     *
     * A cache, not state: it is a pure function of the navigation grid and the
     * group's goal, so both peers rebuild the same polyline from the same shared
     * facts and it stays out of `worldHash`. Losing it (the guide dies, an order
     * replaces the script) costs one A* on the next tick and nothing else.
     */
    formationRoute?: FormationRoute;
    /**
     * The group's progress along that route, cached on the same guide: how far
     * along the polyline the group stood last tick, and for how many consecutive
     * ticks it has failed to advance. See `releaseValve` in
     * `engine/systems/task/formation.ts` — the counter is what lets a group that
     * has deadlocked on its own shape let go of it and drive.
     *
     * A cache like `formationRoute`, and out of `worldHash` for the same reason:
     * both peers derive it from the same shared facts in the same order.
     */
    formationProgress?: FormationProgress;
  };
}

/** How far along its route a group has got, and how long it has been failing to. */
export interface FormationProgress {
  along: number;
  stalled: number;
  /** Ticks left of "the shape is not in charge" after a deadlock was broken. */
  released: number;
}

/** A group's cached A* route: the goal tile it was built for, plus the waypoints. */
export interface FormationRoute {
  goalTx: number;
  goalTy: number;
  /** `findPath` output — world-space waypoints, or empty when the goal is unreachable. */
  points: Vec2[];
}

/** A robot's membership of one formation: the shared group id plus the shape it holds. */
export interface RobotFormation {
  /**
   * Shared by every robot the order named, derived from their ids — so both
   * peers compute the same string for the same order without one telling the
   * other. Two identical selections ordered twice land on the same id, which is
   * harmless: they *are* the same group.
   */
  gid: string;
  type: FormationType;
}
