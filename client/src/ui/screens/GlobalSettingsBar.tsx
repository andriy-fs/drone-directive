import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { useGameStore } from '../../store/gameStore';
import { Button } from '../common/Button';
import { CheckIcon, GlobeIcon, HelpCircleIcon, Volume2Icon, VolumeXIcon } from '../common/icons';
import { Menu, MenuButton, MenuItem, MenuItems } from '../common/Menu';
import { LANGUAGE_OPTIONS } from './menuOptions';

/**
 * The title screen's global settings — language, sound, controls — as one compact
 * row of icon buttons in the header.
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
  onOpenControls,
}: {
  onOpenSound: () => void;
  onOpenControls: () => void;
}) {
  const t = useT();
  const locale = useGameStore((s) => s.locale);
  const setLocale = useGameStore((s) => s.setLocale);

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

      {/* `sfx` owns mute state, not the store, so this icon is only as fresh as
          the last render — which is fine: the only way to change it from here is
          the dialog this button opens, and closing it re-renders the menu. */}
      <Button
        className="menu-bar__btn"
        onClick={onOpenSound}
        aria-label={t('aria', 'soundSettings')}
        title={t('sound', 'settings')}
      >
        {sfx.isMuted() ? <VolumeXIcon size={16} aria-hidden /> : <Volume2Icon size={16} aria-hidden />}
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
