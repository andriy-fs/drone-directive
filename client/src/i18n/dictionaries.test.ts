import { describe, expect, it } from 'vitest';
import type { Dict } from './dict';
import { getDict, loadDict } from './dictionaries';
import { Locale } from './locale';

/**
 * The dictionaries are code-split, which trades a static `Record<Locale, Dict>`
 * — where TypeScript alone guaranteed every language was present and complete —
 * for four dynamic imports resolved at runtime. These tests re-establish both
 * halves of that guarantee: every locale loads, and every locale still matches
 * English key for key.
 */

const locales = Object.values(Locale);

/** `{ section: [key, ...] }`, so a mismatch names the section it is in. */
function shape(dict: Dict): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(dict).map(([section, entries]) => [section, Object.keys(entries).sort()]),
  );
}

describe('loadDict', () => {
  it('resolves a populated dictionary for every supported language', async () => {
    for (const locale of locales) {
      const dict = await loadDict(locale);
      expect(Object.keys(dict).length).toBeGreaterThan(0);
      expect(dict.mainMenu.title).toBeTruthy();
    }
  });

  it('caches, so a second call hands back the very same object', async () => {
    const first = await loadDict(Locale.Ru);
    const second = await loadDict(Locale.Ru);
    expect(second).toBe(first);
  });

  it('shares one request between concurrent callers', async () => {
    const [a, b] = await Promise.all([loadDict(Locale.Pl), loadDict(Locale.Pl)]);
    expect(a).toBe(b);
  });
});

describe('getDict', () => {
  it('reads a loaded dictionary synchronously', async () => {
    const loaded = await loadDict(Locale.Uk);
    expect(getDict(Locale.Uk)).toBe(loaded);
  });

  it('throws rather than render undefined when the load was skipped', () => {
    expect(() => getDict('de' as Locale)).toThrow(/before it was loaded/);
  });
});

describe('translation coverage', () => {
  it('gives every language the same sections and keys as English', async () => {
    const english = shape(await loadDict(Locale.En));
    for (const locale of locales.filter((l) => l !== Locale.En)) {
      expect(shape(await loadDict(locale)), `locale "${locale}"`).toEqual(english);
    }
  });
});
