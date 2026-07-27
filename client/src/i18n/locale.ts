import { storage } from '../utils/storage';

/** Supported UI languages. Const-map + union, per this project's no-TS-enum convention. */
export const Locale = { En: 'en', Ru: 'ru', Uk: 'uk', Pl: 'pl' } as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

const STORAGE_KEY = 'dd:locale';

function isLocale(value: string): value is Locale {
  return (Object.values(Locale) as string[]).includes(value);
}

/** Reads the player's previously chosen language, if any was saved. */
export function loadStoredLocale(): Locale | null {
  const stored = storage.getItem(STORAGE_KEY);
  return stored !== null && isLocale(stored) ? stored : null;
}

/** Persists the player's chosen language for future visits. */
export function saveLocale(locale: Locale): void {
  storage.setItem(STORAGE_KEY, locale);
}

/** Matches the browser's preferred languages against the ones this game supports. */
function detectBrowserLocale(): Locale | null {
  const candidates = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const candidate of candidates) {
    const primary = candidate?.toLowerCase().split('-')[0];
    if (primary && isLocale(primary)) return primary;
  }
  return null;
}

/** Saved preference wins; otherwise the browser's language if supported; otherwise English. */
export function resolveInitialLocale(): Locale {
  return loadStoredLocale() ?? detectBrowserLocale() ?? Locale.En;
}
