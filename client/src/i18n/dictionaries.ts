import type { Dict } from './dict';
import { Locale } from './locale';

/**
 * The only place that reaches for a dictionary's contents, so each locale ends
 * up in its own chunk and a player downloads exactly the language they play in.
 *
 * The invariant that keeps `useT()` synchronous: the store's `locale` is only
 * ever set to a locale whose dictionary is already cached here — `main.tsx`
 * awaits the initial one before the first render, and `setLocale` awaits the
 * new one before it switches. Nothing else may write `locale`.
 */
const loaders: Record<Locale, () => Promise<Dict>> = {
  [Locale.En]: () => import('./locales/en').then((m) => m.en),
  [Locale.Ru]: () => import('./locales/ru').then((m) => m.ru),
  [Locale.Uk]: () => import('./locales/uk').then((m) => m.uk),
  [Locale.Pl]: () => import('./locales/pl').then((m) => m.pl),
};

const loaded = new Map<Locale, Dict>();
const inFlight = new Map<Locale, Promise<Dict>>();

/** Fetches a locale's dictionary once; concurrent callers share the one request. */
export function loadDict(locale: Locale): Promise<Dict> {
  const cached = loaded.get(locale);
  if (cached) return Promise.resolve(cached);

  const pending = inFlight.get(locale);
  if (pending) return pending;

  const request = loaders[locale]()
    .then((dict) => {
      loaded.set(locale, dict);
      return dict;
    })
    .finally(() => inFlight.delete(locale));

  inFlight.set(locale, request);
  return request;
}

/** Synchronous read for the render path. Throws if the invariant above was broken. */
export function getDict(locale: Locale): Dict {
  const dict = loaded.get(locale);
  if (!dict) throw new Error(`Dictionary for locale "${locale}" was read before it was loaded`);
  return dict;
}
