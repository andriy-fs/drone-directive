import type { Vec2 } from '../../types/entities';
import { TaskType, WeaponType } from '../../types/enums';
import type { RobotScript } from '../../types/tasks';

/** Attack-oriented directives that are pointless for a weaponless robot (radar: 0 range, 0 damage). */
const FORBIDDEN_FOR_RADAR = new Set<TaskType>([TaskType.AttackBase, TaskType.AttackRobots]);

/**
 * Whether assigning `task` to a robot carrying `weaponType` should be refused.
 * A radar has nothing to fight with — walking it into "Attack Base"/"Attack
 * Robots" just marches it forward to stand there uselessly (and die). The
 * caller should leave the robot's current script untouched when this is true.
 */
export function isTaskBlockedForWeapon(weaponType: WeaponType | undefined, task: TaskType): boolean {
  return weaponType === WeaponType.Radar && FORBIDDEN_FOR_RADAR.has(task);
}

/**
 * Factories turning a program choice (a `TaskType` id) into a concrete script.
 * The directive list lives in the program registry (`config/programs.ts`); a
 * script only carries the program id + per-robot blackboard (e.g. a guard post).
 */

export function makeIdle(): RobotScript {
  return { programId: TaskType.Idle, blackboard: {} };
}

export function makeGuard(pos: Vec2): RobotScript {
  return { programId: TaskType.Guard, blackboard: { guardPos: { x: pos.x, y: pos.y } } };
}

export function makeAttackBase(): RobotScript {
  return { programId: TaskType.AttackBase, blackboard: {} };
}

export function makeAttackRobots(): RobotScript {
  return { programId: TaskType.AttackRobots, blackboard: {} };
}

export function makeScout(): RobotScript {
  return { programId: TaskType.Scout, blackboard: {} };
}

/** Focus-fire a specific ordered target (robot or base) — see the AttackTarget program. */
export function makeAttackTarget(targetId: string): RobotScript {
  return { programId: TaskType.AttackTarget, blackboard: { attackTargetId: targetId } };
}

/** Unarmed support role: trail the group or hold near base, retreating if hit. */
export function makeOverwatch(): RobotScript {
  return { programId: TaskType.Overwatch, blackboard: {} };
}

/**
 * Resolves a *generic* program id into a concrete script; `pos` seeds a guard
 * post. `AttackTarget` needs a target id (not available here), so it isn't a
 * generic pick — use `makeAttackTarget`; a stray request falls back to Idle.
 */
export function scriptForTask(pos: Vec2, task: TaskType): RobotScript {
  switch (task) {
    case TaskType.Guard:
      return makeGuard(pos);
    case TaskType.AttackBase:
      return makeAttackBase();
    case TaskType.AttackRobots:
      return makeAttackRobots();
    case TaskType.Scout:
      return makeScout();
    case TaskType.Overwatch:
      return makeOverwatch();
    case TaskType.AttackTarget:
    case TaskType.Idle:
      return makeIdle();
  }
}
