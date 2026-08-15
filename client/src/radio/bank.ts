import { Locale } from '../i18n/locale';
import type { PhraseBank } from './types';

/**
 * The only module that reaches for a phrase bank's contents, so each locale ends
 * up in its own chunk and a player downloads flavour text for the language they
 * play in and no other.
 *
 * Deliberately a sibling of `i18n/dictionaries.ts` rather than part of it. The
 * dictionary is awaited before the first render — everything in it is on the
 * critical path. A phrase bank is not: nothing on screen needs it until a match
 * is running, and it is an order of magnitude larger than the UI strings. Hence
 * the one difference from `dictionaries.ts` below: the synchronous accessor
 * returns `null` instead of throwing. A bank that has not arrived yet is a normal
 * state, and the radio simply stays quiet through it.
 */
const loaders: Record<Locale, () => Promise<PhraseBank>> = {
  [Locale.En]: () => import('./locales/en').then((m) => m.en),
  [Locale.Ru]: () => import('./locales/ru').then((m) => m.ru),
  [Locale.Uk]: () => import('./locales/uk').then((m) => m.uk),
  [Locale.Pl]: () => import('./locales/pl').then((m) => m.pl),
};

const loaded = new Map<Locale, PhraseBank>();
const inFlight = new Map<Locale, Promise<PhraseBank>>();

/** Fetches a locale's bank once; concurrent callers share the one request. */
export function loadBank(locale: Locale): Promise<PhraseBank> {
  const cached = loaded.get(locale);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(locale);
  if (pending) return pending;

  const request = loaders[locale]()
    .then((bank) => {
      loaded.set(locale, bank);
      return bank;
    })
    .finally(() => inFlight.delete(locale));

  inFlight.set(locale, request);
  return request;
}

/**
 * Synchronous read for the render path. `null` while the chunk is still coming
 * down — see the note above; callers render nothing rather than block.
 */
export function tryGetBank(locale: Locale): PhraseBank | null {
  return loaded.get(locale) ?? null;
}
