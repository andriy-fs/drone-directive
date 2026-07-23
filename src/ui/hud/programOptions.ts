import { TaskType } from '../../types/enums';

/** Human-readable label for every program id. */
export const TASK_LABELS: Record<TaskType, string> = {
  [TaskType.Idle]: 'Idle',
  [TaskType.Guard]: 'Guard',
  [TaskType.AttackBase]: 'Attack Base',
  [TaskType.AttackRobots]: 'Attack Robots',
  [TaskType.Scout]: 'Search & Detect',
  [TaskType.AttackTarget]: 'Attack Target',
};

/** Programs a player can actively assign to a live unit (Idle is engine-internal). */
export const ASSIGNABLE_TASKS: TaskType[] = [
  TaskType.Guard,
  TaskType.AttackBase,
  TaskType.AttackRobots,
  TaskType.Scout,
];

/** Build/setup options: the assignable programs plus a "None" (null) choice. */
export const PROGRAM_OPTIONS: { value: TaskType | null; label: string }[] = [
  { value: null, label: 'None' },
  ...ASSIGNABLE_TASKS.map((task) => ({ value: task, label: TASK_LABELS[task] })),
];

/** Display label for a program id (or "None" for `null`). */
export function programLabel(task: TaskType | null): string {
  return task === null ? 'None' : TASK_LABELS[task];
}
