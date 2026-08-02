import type { ChipOption } from '../common/Picker';
import { maxAiOpponents } from '../../config/gameSettings';
import { Locale, type T } from '../../i18n';
import { Difficulty, MapSize } from '@drone-directive/types/enums';

/**
 * The title screen's chip choices, in the active language — the same shape as
 * `ui/hud/programOptions.ts`, so the menu component stays layout-only and the
 * "what can be picked" question has one home.
 */

/** Languages the UI ships with. Labels are the endonym codes, so no `t` needed. */
export const LANGUAGE_OPTIONS: ChipOption<Locale>[] = [
  { value: Locale.En, label: 'EN' },
  { value: Locale.Uk, label: 'UK' },
  { value: Locale.Pl, label: 'PL' },
  { value: Locale.Ru, label: 'RU' },
];

export function difficultyOptions(t: T): ChipOption<Difficulty>[] {
  return [
    { value: Difficulty.Easy, label: t('difficulty', 'easy'), hint: t('difficulty', 'easyHint') },
    { value: Difficulty.Normal, label: t('difficulty', 'normal'), hint: t('difficulty', 'normalHint') },
    { value: Difficulty.Hard, label: t('difficulty', 'hard'), hint: t('difficulty', 'hardHint') },
  ];
}

export function mapSizeOptions(t: T): ChipOption<MapSize>[] {
  return [
    { value: MapSize.Small, label: t('mapSize', 'small'), hint: t('mapSize', 'smallHint') },
    { value: MapSize.Medium, label: t('mapSize', 'medium'), hint: t('mapSize', 'mediumHint') },
    { value: MapSize.Large, label: t('mapSize', 'large'), hint: t('mapSize', 'largeHint') },
  ];
}

/** Bot counts a solo match can seat — one human already holds a corner. */
export function opponentOptions(t: T): ChipOption<number>[] {
  return Array.from({ length: maxAiOpponents(false) }, (_, i) => ({
    value: i + 1,
    label: i + 1,
    hint: t('mainMenu', 'opponentsHint'),
  }));
}
