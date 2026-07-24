import type { T } from '../../i18n';
import { TaskType } from '../../types/enums';

/** Programs a player can actively assign to a live unit (Idle is engine-internal). */
export const ASSIGNABLE_TASKS: TaskType[] = [
  TaskType.Guard,
  TaskType.AttackBase,
  TaskType.AttackRobots,
  TaskType.Scout,
];

/** Human-readable label for every program id, in the active language. */
export function taskLabels(t: T): Record<TaskType, string> {
  return {
    [TaskType.Idle]: t('programs', 'idle'),
    [TaskType.Guard]: t('programs', 'guard'),
    [TaskType.AttackBase]: t('programs', 'attackBase'),
    [TaskType.AttackRobots]: t('programs', 'attackRobots'),
    [TaskType.Scout]: t('programs', 'scout'),
    [TaskType.AttackTarget]: t('programs', 'attackTarget'),
  };
}

/** Build/setup options: the assignable programs plus a "None" (null) choice. */
export function programOptions(t: T): { value: TaskType | null; label: string }[] {
  const labels = taskLabels(t);
  return [
    { value: null, label: t('programs', 'none') },
    ...ASSIGNABLE_TASKS.map((task) => ({ value: task, label: labels[task] })),
  ];
}

/** Display label for a program id (or "None" for `null`). */
export function programLabel(task: TaskType | null, t: T): string {
  return task === null ? t('programs', 'none') : taskLabels(t)[task];
}
