import { storage } from '../utils/storage';

/**
 * The UI colour/type schemes the game ships with. Const-map + union, per this
 * project's no-TS-enum convention (the same shape as `i18n/locale.ts`).
 *
 * A value here is the `data-theme` attribute written onto `<html>`, which is the
 * only handle the stylesheets have: `theme/tokens.css` holds the default look on
 * `:root`, and each non-default theme is one file under `theme/themes/` that
 * redefines the same tokens under `[data-theme='…']`. Adding a scheme is three
 * lines and one new file — see `theme/README.md`.
 */
export const Theme = {
  /**
   * Cold blue command console. The **base** scheme, not the default one: its
   * values are the ones on `:root` in `tokens.css`, which is what every other
   * theme overrides and falls back to. Picking it means writing an attribute no
   * stylesheet matches, which is exactly right — bare `:root` is its look.
   */
  Command: 'command',
  /** Green phosphor CRT — monochrome, glowing, under scanlines. */
  Crt: 'crt',
} as const;
export type Theme = (typeof Theme)[keyof typeof Theme];

/**
 * What a player who has never chosen sees. Deliberately *not* `Command`, which
 * is only the base the tokens are defined against — the two roles are separate
 * on purpose, so the default can move without anything having to be rewritten
 * from `:root` into a theme file.
 */
export const DEFAULT_THEME: Theme = Theme.Crt;

const STORAGE_KEY = 'dd:theme';

function isTheme(value: string): value is Theme {
  return (Object.values(Theme) as string[]).includes(value);
}

/** Reads the player's previously chosen theme, if any was saved. */
export function loadStoredTheme(): Theme | null {
  const stored = storage.getItem(STORAGE_KEY);
  return stored !== null && isTheme(stored) ? stored : null;
}

/** Persists the player's chosen theme for future visits. */
export function saveTheme(theme: Theme): void {
  storage.setItem(STORAGE_KEY, theme);
}

/** Saved preference, or the default scheme. */
export function resolveInitialTheme(): Theme {
  return loadStoredTheme() ?? DEFAULT_THEME;
}

/**
 * Puts the theme on `<html>`, which is what every `[data-theme='…']` block hangs
 * off. Unlike the locale there is nothing async about it: the token files are in
 * the bundle's CSS, so the switch is one attribute write and a repaint.
 */
export function applyDocumentTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}
