import { describe, expect, it } from 'vitest';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import { Locale } from '../i18n/locale';
import { loadBank, tryGetBank } from './bank';
import { callsign, formatLine, stamp } from './format';
import { MIN_VARIANTS, RADIO_KEYS, SLOTS_BY_KEY, type PhraseBank, type RadioKey } from './types';

/**
 * The banks are code-split and generated, which means TypeScript checks their
 * *shape* but nothing checks their contents: a missing key, a thin array or a
 * mistyped `{untl}` would all compile and then show up on the player's screen.
 * These tests are that check — which is why they assert on content (counts, slot
 * names, duplicates, line length) rather than on behaviour.
 */

const locales = Object.values(Locale);
const SLOT_PATTERN = /\{([^}]*)\}/g;

function slotsIn(text: string): string[] {
  return [...text.matchAll(SLOT_PATTERN)].map((m) => m[1]);
}

describe('loadBank', () => {
  it('resolves a populated bank for every supported language', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      expect(bank.hq, `locale "${locale}"`).toBeTruthy();
      expect(Object.keys(bank.lines), `locale "${locale}"`).toHaveLength(RADIO_KEYS.length);
    }
  });

  it('caches, so a second call hands back the very same object', async () => {
    const first = await loadBank(Locale.Ru);
    const second = await loadBank(Locale.Ru);
    expect(second).toBe(first);
  });

  it('shares one request between concurrent callers', async () => {
    const [a, b] = await Promise.all([loadBank(Locale.Pl), loadBank(Locale.Pl)]);
    expect(a).toBe(b);
  });
});

describe('tryGetBank', () => {
  it('reads a loaded bank synchronously', async () => {
    const loaded = await loadBank(Locale.Uk);
    expect(tryGetBank(Locale.Uk)).toBe(loaded);
  });

  it('returns null rather than throw when the chunk has not arrived', () => {
    // Unlike `getDict`, a bank that is not there yet is a normal state — the feed
    // stays quiet through it instead of taking the app down.
    expect(tryGetBank('de' as Locale)).toBeNull();
  });
});

describe('bank coverage', () => {
  it('gives every language every key, with enough variants to not repeat', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      for (const key of RADIO_KEYS) {
        expect(bank.lines[key], `locale "${locale}" key "${key}"`).toBeDefined();
        expect(bank.lines[key].length, `locale "${locale}" key "${key}"`).toBeGreaterThanOrEqual(MIN_VARIANTS);
      }
    }
  });

  it('names every chassis × weapon combination', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      for (const chassis of Object.values(ChassisType)) {
        for (const weapon of Object.values(WeaponType)) {
          expect(bank.units[chassis]?.[weapon], `locale "${locale}" ${chassis}/${weapon}`).toBeTruthy();
        }
      }
    }
  });

  it('uses only the slots its key is allowed to fill', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      for (const key of RADIO_KEYS) {
        const allowed: readonly string[] = SLOTS_BY_KEY[key];
        for (const line of bank.lines[key]) {
          for (const slot of slotsIn(line)) {
            expect(allowed, `locale "${locale}" key "${key}": "${line}"`).toContain(slot);
          }
        }
      }
    }
  });

  it('has no duplicate variants inside a key', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      for (const key of RADIO_KEYS) {
        const lines = bank.lines[key];
        expect(new Set(lines).size, `locale "${locale}" key "${key}"`).toBe(lines.length);
      }
    }
  });

  it('keeps lines short enough for a narrow feed', async () => {
    for (const locale of locales) {
      const bank = await loadBank(locale);
      for (const key of RADIO_KEYS) {
        for (const line of bank.lines[key]) {
          expect(line.length, `locale "${locale}" key "${key}": "${line}"`).toBeLessThanOrEqual(70);
        }
      }
    }
  });
});

describe('formatLine', () => {
  const bank: PhraseBank = {
    units: {
      [ChassisType.Tracks]: { ...blankWeapons(), [WeaponType.Missiles]: 'TRK.MLRS' },
      [ChassisType.Wheels]: { ...blankWeapons(), [WeaponType.Cannon]: 'WHL.GUN' },
      [ChassisType.Legs]: blankWeapons(),
    },
    hq: 'HQ',
    lines: { ...blankLines(), spotted: ['contact at {x}, {y}', 'movement: {x}, {y}'], lost: ['lost {unit}'] },
  };

  it('names the speaker, or falls back to HQ', () => {
    const unit = { chassis: ChassisType.Tracks, weapon: WeaponType.Missiles, n: 2 };
    expect(formatLine(bank, 'spotted', 0, { speaker: unit, x: 34, y: 12 }).speaker).toBe('TRK.MLRS-2');
    expect(formatLine(bank, 'spotted', 0, { x: 34, y: 12 }).speaker).toBe('HQ');
  });

  it('picks the variant by seed, wrapping past the end', () => {
    expect(formatLine(bank, 'spotted', 0, { x: 1, y: 2 }).text).toBe('contact at 1, 2');
    expect(formatLine(bank, 'spotted', 1, { x: 1, y: 2 }).text).toBe('movement: 1, 2');
    expect(formatLine(bank, 'spotted', 2, { x: 1, y: 2 }).text).toBe('contact at 1, 2');
  });

  it('fills {unit} with a different unit than the speaker', () => {
    const casualty = { chassis: ChassisType.Wheels, weapon: WeaponType.Cannon, n: 7 };
    expect(formatLine(bank, 'lost', 0, { unit: casualty }).text).toBe('lost WHL.GUN-7');
  });

  it('leaves a slot it was given no value for visible rather than blank', () => {
    expect(formatLine(bank, 'spotted', 0, {}).text).toBe('contact at {x}, {y}');
  });

  it('builds a callsign from the stem and the running number', () => {
    expect(callsign(bank, { chassis: ChassisType.Tracks, weapon: WeaponType.Missiles, n: 11 })).toBe('TRK.MLRS-11');
  });
});

describe('stamp', () => {
  it('renders mm:ss, padded, and never negative', () => {
    expect(stamp(0)).toBe('00:00');
    expect(stamp(9_000)).toBe('00:09');
    expect(stamp(72_000)).toBe('01:12');
    expect(stamp(-5_000)).toBe('00:00');
  });
});

function blankWeapons(): Record<WeaponType, string> {
  return Object.fromEntries(Object.values(WeaponType).map((w) => [w, '?'])) as Record<WeaponType, string>;
}

function blankLines(): Record<RadioKey, string[]> {
  return Object.fromEntries(RADIO_KEYS.map((k) => [k, ['-']])) as Record<RadioKey, string[]>;
}
