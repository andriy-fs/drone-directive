import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dict } from '../i18n/dict';
import { Locale } from '../i18n/locale';

/**
 * `setLocale` is the one store action that cannot apply its argument straight
 * away: the dictionaries are code-split, so it has to load first and switch
 * after. That makes two failure modes worth pinning down — showing a language
 * whose dictionary never arrived, and letting a slow load overwrite a newer pick.
 */

/** Hand-controlled `loadDict`: each call parks until the test resolves or rejects it. */
const pending = new Map<Locale, { resolve: () => void; reject: (error: Error) => void }>();

vi.mock('../i18n/dictionaries', () => ({
  loadDict: (locale: Locale) =>
    new Promise<Dict>((resolve, reject) => {
      pending.set(locale, { resolve: () => resolve({} as Dict), reject });
    }),
}));

const saveLocale = vi.fn();
vi.mock('../i18n/locale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../i18n/locale')>()),
  saveLocale: (locale: Locale) => saveLocale(locale),
}));

const { useGameStore } = await import('./gameStore');

/** Lets the `.then` chains inside `setLocale` run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  pending.clear();
  saveLocale.mockClear();
  useGameStore.setState({ locale: Locale.En });
});

describe('setLocale', () => {
  it('waits for the dictionary before switching the language', async () => {
    useGameStore.getState().setLocale(Locale.Ru);
    await flush();
    expect(useGameStore.getState().locale).toBe(Locale.En);
    expect(saveLocale).not.toHaveBeenCalled();

    pending.get(Locale.Ru)!.resolve();
    await flush();
    expect(useGameStore.getState().locale).toBe(Locale.Ru);
    expect(saveLocale).toHaveBeenCalledWith(Locale.Ru);
  });

  it('keeps the newest pick when an earlier load resolves late', async () => {
    useGameStore.getState().setLocale(Locale.Ru);
    useGameStore.getState().setLocale(Locale.Uk);

    pending.get(Locale.Uk)!.resolve();
    await flush();
    expect(useGameStore.getState().locale).toBe(Locale.Uk);

    pending.get(Locale.Ru)!.resolve(); // the straggler must not win
    await flush();
    expect(useGameStore.getState().locale).toBe(Locale.Uk);
    expect(saveLocale).not.toHaveBeenCalledWith(Locale.Ru);
  });

  it('stays on the current language when the dictionary fails to load', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    useGameStore.getState().setLocale(Locale.Pl);
    pending.get(Locale.Pl)!.reject(new Error('offline'));
    await flush();

    expect(useGameStore.getState().locale).toBe(Locale.En);
    expect(saveLocale).not.toHaveBeenCalled(); // an unreachable language must not be persisted
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
