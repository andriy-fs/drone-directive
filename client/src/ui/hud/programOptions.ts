import type { T } from '../../i18n';
import { TaskType } from '@drone-directive/types/enums';
import {
  CastleIcon,
  CrosshairIcon,
  EyeIcon,
  type LucideIcon,
  PauseIcon,
  RadarIcon,
  ShieldIcon,
  SwordsIcon,
} from '../common/icons';

/** Programs a player can actively assign to a live unit (Idle is engine-internal). */
export const ASSIGNABLE_TASKS: TaskType[] = [
  TaskType.Guard,
  TaskType.AttackBase,
  TaskType.AttackRobots,
  TaskType.Scout,
  TaskType.Overwatch,
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
    [TaskType.Overwatch]: t('programs', 'overwatch'),
  };
}

/**
 * Glyph for every program id. Only `ASSIGNABLE_TASKS` are ever drawn, but the map
 * is total so adding a TaskType can't silently leave a tile without an icon.
 */
export const TASK_ICONS: Record<TaskType, LucideIcon> = {
  [TaskType.Idle]: PauseIcon,
  [TaskType.Guard]: ShieldIcon,
  [TaskType.AttackBase]: CastleIcon,
  [TaskType.AttackRobots]: SwordsIcon,
  [TaskType.Scout]: RadarIcon,
  [TaskType.AttackTarget]: CrosshairIcon,
  [TaskType.Overwatch]: EyeIcon,
};

/**
 * Dictionary key describing what each assignable directive actually makes a unit
 * do — see `config/programs.ts` for the behaviour these summarise. Partial by
 * design: `Idle` and `AttackTarget` are reached by gesture, never offered as a
 * choice, so there is nothing to hover over.
 */
const TASK_NOTES: Partial<Record<TaskType, 'guardNote' | 'attackBaseNote' | 'attackRobotsNote' | 'scoutNote' | 'overwatchNote'>> =
  {
    [TaskType.Guard]: 'guardNote',
    [TaskType.AttackBase]: 'attackBaseNote',
    [TaskType.AttackRobots]: 'attackRobotsNote',
    [TaskType.Scout]: 'scoutNote',
    [TaskType.Overwatch]: 'overwatchNote',
  };

/** Tooltip for a directive tile, or undefined for a program the player can't pick. */
export function taskHint(task: TaskType, t: T): string | undefined {
  const key = TASK_NOTES[task];
  return key ? t('programs', key) : undefined;
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
