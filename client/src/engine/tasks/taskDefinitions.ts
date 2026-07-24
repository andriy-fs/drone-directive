import type { Vec2 } from '../../types/entities';
import { TaskType } from '../../types/enums';
import type { RobotScript } from '../../types/tasks';

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
    case TaskType.AttackTarget:
    case TaskType.Idle:
      return makeIdle();
  }
}
