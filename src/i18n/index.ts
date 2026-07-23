import { useGameStore } from '../store/gameStore';
import { Locale } from './locale';
import { en, type Dict } from './locales/en';
import { pl } from './locales/pl';
import { ru } from './locales/ru';
import { uk } from './locales/uk';

export { Locale };

const dictionaries: Record<Locale, Dict> = { en, ru, uk, pl };

/** Reads the active locale's translated string for `dict[section][key]`. */
export type T = <S extends keyof Dict>(section: S, key: keyof Dict[S]) => string;

/** Translation hook: re-renders the caller whenever the store's `locale` changes. */
export function useT(): T {
  const locale = useGameStore((s) => s.locale);
  const dict = dictionaries[locale];
  return (section, key) => dict[section][key] as string;
}
