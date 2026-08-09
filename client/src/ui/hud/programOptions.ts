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
  ShieldCheckIcon,
  ShieldIcon,
  SwordsIcon,
  UsersIcon,
} from '../common/icons';

/**
 * Programs a player can actively assign to a live unit (Idle is engine-internal).
 * Ordered defence → offence → support, so the grid reads as a spectrum.
 *
 * `GroupAttack` is deliberately absent: it exists so the bot attacks in bodies
 * instead of trickling units out one at a time, and a player who wants that just
 * selects the units and orders them out together. Handing it over would only
 * offer an attack order that sits at base doing nothing until a headcount is met.
 */
export const ASSIGNABLE_TASKS: TaskType[] = [
  TaskType.Guard,
  TaskType.DefendBase,
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
    [TaskType.DefendBase]: t('programs', 'defendBase'),
    [TaskType.GroupAttack]: t('programs', 'groupAttack'),
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
  [TaskType.DefendBase]: ShieldCheckIcon,
  [TaskType.GroupAttack]: UsersIcon,
};

/**
 * Dictionary key describing what each assignable directive actually makes a unit
 * do — see `config/programs.ts` for the behaviour these summarise. Partial by
 * design: `Idle` and `AttackTarget` are reached by gesture and `GroupAttack` is
 * the bot's alone, so none of the three is ever offered as a choice and there is
 * nothing to hover over.
 */
type TaskNoteKey =
  | 'guardNote'
  | 'defendBaseNote'
  | 'attackBaseNote'
  | 'attackRobotsNote'
  | 'scoutNote'
  | 'overwatchNote';

const TASK_NOTES: Partial<Record<TaskType, TaskNoteKey>> = {
  [TaskType.Guard]: 'guardNote',
  [TaskType.DefendBase]: 'defendBaseNote',
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
 * The directive cards, for both the in-match build dialog and the pre-game base
 * setup. There is deliberately no "None" card in either: a robot leaving the
 * factory always carries a standing order of its own, and offering "no
 * directive" only ever bought a passive unit that returns fire briefly and never
 * closes on whatever is shooting it.
 *
 * `Idle` itself is untouched — the engine still uses it (a right-click move order
 * resets to it, so a manual destination survives the resolver), it is simply not
 * something the player picks up front.
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
 * Display label for a program id, or "None" for `null`. Still handles `null`
 * with the card gone: `production.defaultTask` is genuinely nullable — the wire
 * carries "explicitly no program" as a distinct build-order state — so the HUD
 * panels that read a base back may find one.
 */
export function programLabel(task: TaskType | null, t: T): string {
  return task === null ? t('programs', 'none') : taskLabels(t)[task];
}
