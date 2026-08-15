import type { PhraseBank, RadioKey, RadioParams, UnitRef } from './types';

/** A line ready for the screen: who is speaking, and what they said. */
export interface FormattedLine {
  speaker: string;
  text: string;
}

/** "ГУС.РСЗО-2" — the stem from the bank, the number from the director. */
export function callsign(bank: PhraseBank, unit: UnitRef): string {
  return `${bank.units[unit.chassis][unit.weapon]}-${unit.n}`;
}

/**
 * Resolves a stored line against a bank. Text is picked by `seed % length` rather
 * than stored, which is what lets the feed survive a mid-match language switch:
 * the same line re-renders in the new language instead of freezing in the old one,
 * and the seed stays meaningful even though the locales have different counts.
 */
export function formatLine(bank: PhraseBank, key: RadioKey, seed: number, params: RadioParams): FormattedLine {
  const variants = bank.lines[key];
  const template = variants[seed % variants.length];
  return {
    speaker: params.speaker ? callsign(bank, params.speaker) : bank.hq,
    text: fill(bank, template, params),
  };
}

/**
 * One pass over the template. An unknown slot is left as-is rather than blanked —
 * the bank test and `check-radio-bank.mjs` reject those before they ship, so if
 * one ever reaches here it should be visible, not silently swallowed.
 */
function fill(bank: PhraseBank, template: string, params: RadioParams): string {
  return template.replace(/\{(unit|x|y)\}/g, (match, slot: string) => {
    if (slot === 'unit') return params.unit ? callsign(bank, params.unit) : match;
    const value = slot === 'x' ? params.x : params.y;
    return value === undefined ? match : String(value);
  });
}

/** `mm:ss` since the match started, the prefix on every line. */
export function stamp(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
