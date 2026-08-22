import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { music } from '../../pixi/audio/music';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../common/Button';
import {
  CheckIcon,
  GlobeIcon,
  GraphicsIcon,
  HelpCircleIcon,
  PaletteIcon,
  Volume2Icon,
  VolumeXIcon,
} from '../common/icons';
import { Menu, MenuButton, MenuItem, MenuItems } from '../common/Menu';
import { LANGUAGE_OPTIONS, themeOptions } from './menuOptions';

/**
 * The title screen's global settings — language, theme, sound, controls — as one
 * compact row of icon buttons in the header.
 *
 * These are app-wide preferences that outlive any match, so grouping them apart
 * from the match rules is the point: previously they sat in the same vertical
 * list as difficulty and map size, which said they were the same kind of choice.
 *
 * Sound and Help only *open* their dialogs; the menu owns the single modal slot
 * that decides which one is showing (see `MainMenu`).
 */
export function GlobalSettingsBar({
  onOpenSound,
  onOpenGraphics,
  onOpenControls,
}: {
  onOpenSound: () => void;
  onOpenGraphics: () => void;
  onOpenControls: () => void;
}) {
  const t = useT();
  const locale = useGameStore((s) => s.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const theme = useGameStore((s) => s.theme);
  const setTheme = useGameStore((s) => s.setTheme);
  const themes = themeOptions(t);

  return (
    <div className="menu-bar">
      {/* A `Menu` rather than a `Dialog`: it takes no place in Headless UI's
          layer stack, so opening it over the title screen is free of the nesting
          trap the modals below have to respect. */}
      <Menu>
        {/* The one button in the app that isn't the shared `Button`: Headless UI
            narrows a custom `as` component's props and drops `title` with them.
            It carries `.btn` and clicks for itself instead. */}
        <MenuButton
          className="btn menu-bar__btn"
          onClick={() => sfx.buttonClick()}
          aria-label={t('aria', 'language')}
          title={t('aria', 'language')}
        >
          <GlobeIcon size={16} aria-hidden />
        </MenuButton>
        <MenuItems anchor="bottom end" className="menu-lang__items">
          {LANGUAGE_OPTIONS.map((option) => (
            <MenuItem key={option.value}>
              <Button className="menu-lang__item" onClick={() => setLocale(option.value)}>
                {option.label}
                {option.value === locale && <CheckIcon size={14} aria-hidden />}
              </Button>
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>

      {/* The UI scheme, in the same dropdown shape as the language beside it —
          both are app-wide preferences with a handful of named values, and the
          list is short enough that a dialog would be ceremony. Every theme's
          tokens ship in the bundle's CSS, so picking one repaints on the spot;
          `main.tsx` is what puts it on <html>. */}
      <Menu>
        <MenuButton
          className="btn menu-bar__btn"
          onClick={() => sfx.buttonClick()}
          aria-label={t('aria', 'theme')}
          title={t('aria', 'theme')}
        >
          <PaletteIcon size={16} aria-hidden />
        </MenuButton>
        <MenuItems anchor="bottom end" className="menu-lang__items">
          {themes.map((option) => (
            <MenuItem key={option.value}>
              <Button className="menu-lang__item" onClick={() => setTheme(option.value)}>
                {option.label}
                {option.value === theme && <CheckIcon size={14} aria-hidden />}
              </Button>
            </MenuItem>
          ))}
        </MenuItems>
      </Menu>

      {/* `sfx` and `music` own their settings, not the store, so this icon is
          only as fresh as the last render — which is fine: the only way to
          change them from here is the dialog this button opens, and closing it
          re-renders the menu. Crossed out only when both channels are off; music
          alone being silenced is not a muted game. */}
      <Button
        className="menu-bar__btn"
        onClick={onOpenSound}
        aria-label={t('aria', 'soundSettings')}
        title={t('sound', 'settings')}
      >
        {sfx.isMuted() && !music.isEnabled() ? (
          <VolumeXIcon size={16} aria-hidden />
        ) : (
          <Volume2Icon size={16} aria-hidden />
        )}
      </Button>

      <Button
        className="menu-bar__btn"
        onClick={onOpenGraphics}
        aria-label={t('graphics', 'settings')}
        title={t('graphics', 'settings')}
      >
        <GraphicsIcon size={16} aria-hidden />
      </Button>

      <Button
        className="menu-bar__btn"
        onClick={onOpenControls}
        aria-label={t('mainMenu', 'controls')}
        title={t('mainMenu', 'controls')}
      >
        <HelpCircleIcon size={16} aria-hidden />
      </Button>
    </div>
  );
}
