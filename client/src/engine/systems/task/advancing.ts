import { TaskType } from '@drone-directive/types/enums';
import type { Entity } from '../../ecs/entity';

/**
 * Directives that count as an advancing "vanguard" — what Overwatch trails
 * behind, and what `systems/ai/index.ts` counts to decide whether a push is under way
 * for a support unit to join.
 */
export const ADVANCING_TASKS = new Set<TaskType>([TaskType.AttackBase, TaskType.AttackRobots, TaskType.AttackTarget]);

/**
 * Whether a robot is part of a push right now. `GroupAttack` is the one program
 * that is only *sometimes* advancing — a group still gathering at base is
 * holding the line, not leading a charge, and counting it would have Overwatch
 * trail a stationary huddle and let a `dew` leave home behind units that haven't
 * moved yet.
 */
export function isAdvancing(e: Entity): boolean {
  const script = e.script;
  if (!script) return false;
  if (script.programId === TaskType.GroupAttack) return script.blackboard.committed === true;
  return ADVANCING_TASKS.has(script.programId);
}
