import type { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * What the radio can announce. One key per narratable moment, not one per bus
 * event: `entityDestroyed` splits three ways here (`killed`/`killedBase`/`lost`)
 * because a kill and a loss are opposite lines with opposite tones, and the bus
 * cannot know which one the local player just lived through.
 */
export type RadioKey =
  | 'spotted'
  | 'spottedBase'
  | 'killed'
  | 'killedBase'
  | 'lost'
  | 'baseLost'
  | 'produced'
  | 'capReached'
  | 'shieldUp'
  | 'shieldDown'
  | 'shieldShattered'
  | 'enemyEliminated'
  | 'victory'
  | 'defeat';

export const RADIO_KEYS: readonly RadioKey[] = [
  'spotted',
  'spottedBase',
  'killed',
  'killedBase',
  'lost',
  'baseLost',
  'produced',
  'capReached',
  'shieldUp',
  'shieldDown',
  'shieldShattered',
  'enemyEliminated',
  'victory',
  'defeat',
];

/**
 * A unit as the radio refers to it: what it is, plus the running number the
 * director hands out. Stored rather than pre-rendered, because the callsign stem
 * is translated — a line already hanging in the feed has to switch language with
 * everything else.
 */
export interface UnitRef {
  chassis: ChassisType;
  weapon: WeaponType;
  /** Per side + chassis, assigned on first mention. See `radioDirector.ts`. */
  n: number;
}

/**
 * Slot values for one line. `speaker` absent means the line comes from HQ — the
 * impersonal voice used when no unit can claim it (a base lost, the match won).
 * `unit` is a *different* unit the phrase talks about, which is why `lost` needs
 * it: the casualty is not the one reporting.
 */
export interface RadioParams {
  speaker?: UnitRef;
  unit?: UnitRef;
  /** Tile coordinates, already converted from world pixels by the director. */
  x?: number;
  y?: number;
}

/**
 * One locale's phrases. Loaded lazily per locale (`bank.ts`) and never merged
 * into `i18n`'s `Dict`: the dictionary is awaited before the first render, and
 * this must not be.
 */
export interface PhraseBank {
  /**
   * Callsign stem per chassis × weapon — "ГУС.РСЗО", "TRK.MLRS". Short and
   * abbreviated on purpose: it is a prefix on every line, and the feed is narrow.
   */
  units: Record<ChassisType, Record<WeaponType, string>>;
  /** Speaker label for lines nobody in the field is reporting. */
  hq: string;
  lines: Record<RadioKey, string[]>;
}

/**
 * Every slot a phrase may contain. The bank test and `check-radio-bank.mjs` both
 * refuse anything outside this list, so a typo in a generated string fails loudly
 * instead of rendering as literal `{untl}` in front of the player.
 */
export const RADIO_SLOTS = ['unit', 'x', 'y'] as const;

/**
 * Which slots each key is allowed to use. Tighter than `RADIO_SLOTS` on purpose:
 * `killed` has no coordinates to name, and a phrase asking for `{x}` there would
 * render an empty gap. The director fills exactly these and nothing else.
 */
export const SLOTS_BY_KEY: Record<RadioKey, readonly (typeof RADIO_SLOTS)[number][]> = {
  spotted: ['x', 'y'],
  spottedBase: ['x', 'y'],
  killed: [],
  killedBase: [],
  lost: ['unit'],
  baseLost: [],
  produced: [],
  capReached: [],
  shieldUp: [],
  shieldDown: [],
  shieldShattered: [],
  enemyEliminated: [],
  victory: [],
  defeat: [],
};

/** Minimum variants per key. Enforced by the bank test and the checker script. */
export const MIN_VARIANTS = 12;
