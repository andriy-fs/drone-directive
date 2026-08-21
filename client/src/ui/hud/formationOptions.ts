import type { T } from '../../i18n';
import { FormationType } from '@drone-directive/types/enums';
import {
  BoxFormationIcon,
  LineFormationIcon,
  type LucideIcon,
  NoFormationIcon,
  SpreadFormationIcon,
} from '../common/icons';

/**
 * The formation tiles, and the one non-formation among them.
 *
 * `null` is a real choice here rather than an absence — "fall out" is something
 * the player asks for, and a group that has been broken up on purpose looks
 * exactly like one that never had a shape. Ordered tight → wide, so the row reads
 * as a single axis: how far the group spreads, and therefore whether a jammer's
 * bubble covers it or a kamikaze's blast does.
 *
 * Three shapes and the null. The column and the wedge used to sit here: the
 * column is now something the terrain hands out rather than something the player
 * picks (see `Layout` in `engine/systems/task/formation.ts`), and the wedge was a
 * fifth point on a three-point axis.
 */
export type FormationChoice = FormationType | null;

export const FORMATION_CHOICES: FormationChoice[] = [
  FormationType.Box,
  FormationType.Line,
  FormationType.Spread,
  null,
];

/** Human-readable label for every choice, in the active language. */
export function formationLabels(t: T): Record<string, string> {
  return {
    [FormationType.Box]: t('formations', 'box'),
    [FormationType.Line]: t('formations', 'line'),
    [FormationType.Spread]: t('formations', 'spread'),
    none: t('formations', 'none'),
  };
}

/** Glyph for every choice. Total by construction, so a new shape can't ship without one. */
export const FORMATION_ICONS: Record<string, LucideIcon> = {
  [FormationType.Box]: BoxFormationIcon,
  [FormationType.Line]: LineFormationIcon,
  [FormationType.Spread]: SpreadFormationIcon,
  none: NoFormationIcon,
};

/**
 * Tooltip for a formation tile. Unlike the directive grid — where the notes live
 * behind the card's help button because there are six standing orders to read
 * once — these say what the shape *costs*, and that is worth having under the
 * cursor at the moment of choosing: every shape here trades a jammer's cover
 * against a kamikaze's blast, and the answer changes with what the enemy fields.
 */
export function formationHint(choice: FormationChoice, t: T): string {
  return t('formations', choice === null ? 'noneNote' : `${choice}Note`);
}

/** Key into the label/icon maps; `null` has no enum value of its own. */
export function formationKey(choice: FormationChoice): string {
  return choice ?? 'none';
}
