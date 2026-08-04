import { useGameStore } from '../store/gameStore';
import type { Dict } from './dict';
import { getDict } from './dictionaries';
import { Locale } from './locale';

export { Locale };

/** Reads the active locale's translated string for `dict[section][key]`. */
export type T = <S extends keyof Dict>(section: S, key: keyof Dict[S]) => string;

/**
 * Translation hook: re-renders the caller whenever the store's `locale` changes.
 * The lookup stays synchronous because a locale only reaches the store after its
 * dictionary has been loaded — see the invariant in `dictionaries.ts`.
 */
export function useT(): T {
  const locale = useGameStore((s) => s.locale);
  const dict = getDict(locale);
  return (section, key) => dict[section][key] as string;
}
