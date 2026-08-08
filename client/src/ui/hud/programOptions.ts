import { cardLabel } from '../common/cardLabel';
import type { ChipOption } from '../common/Picker';
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

/**
 * The build modal's directive cards: the five assignable programs and nothing
 * else. There is deliberately no "None" here — a robot ordered from the factory
 * always leaves with a standing order of its own (see `programOptions` for the
 * pre-game setting, which may still say "no directive").
 */
export function directiveOptions(t: T): ChipOption<TaskType>[] {
  const labels = taskLabels(t);
  return ASSIGNABLE_TASKS.map((task) => ({
    value: task,
    label: cardLabel(TASK_ICONS[task], labels[task]),
    hint: taskHint(task, t),
  }));
}

/**
 * Pre-game setup options: the assignable programs plus a "None" (null) choice,
 * meaning a produced robot falls back to whatever its base's default is.
 */
export function programOptions(t: T): ChipOption<TaskType | null>[] {
  return [
    { value: null, label: cardLabel(TASK_ICONS[TaskType.Idle], t('programs', 'none')) },
    ...directiveOptions(t),
  ];
}

/** Display label for a program id (or "None" for `null`). */
export function programLabel(task: TaskType | null, t: T): string {
  return task === null ? t('programs', 'none') : taskLabels(t)[task];
}
