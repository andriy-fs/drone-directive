import {
  DESKTOP_RELEASES_URL,
  DISCORD_INVITE_URL,
  isDesktopApp,
  openDiscord,
  quitDesktopApp,
} from '../../config/platform';
import { useT } from '../../i18n';
import { sfx } from '../../pixi/audio/sfx';
import { Button } from '../common/Button';
import {
  BookOpenIcon,
  DiscordIcon,
  DownloadIcon,
  PowerIcon,
  UserIcon,
  UsersIcon,
} from '../common/icons';

/** Which kind of game the title screen is setting up — one panel per value. */
export type MenuMode = 'single' | 'online';

/**
 * The title screen's left rail: what kind of game you are setting up, and the
 * reference material that isn't a game at all.
 *
 * Singleplayer and Multiplayer are real tabs over the right-hand column, so
 * neither is a dialog and the two can't be open at once. The Unit Guide is a
 * modal and is separated to the foot of the rail, because it is tertiary — it
 * reads documentation and starts nothing.
 */
export function MenuNav({
  mode,
  onSelectMode,
  onOpenUnits,
}: {
  mode: MenuMode;
  onSelectMode: (mode: MenuMode) => void;
  onOpenUnits: () => void;
}) {
  const t = useT();

  return (
    <nav className="menu-nav">
      <Button
        className={`menu-nav__item ${mode === 'single' ? 'menu-nav__item--on' : ''}`.trim()}
        onClick={() => onSelectMode('single')}
        aria-current={mode === 'single' ? 'page' : undefined}
      >
        <UserIcon size={16} aria-hidden />
        <span className="menu-nav__label">{t('mainMenu', 'singleplayer')}</span>
      </Button>

      <Button
        className={`menu-nav__item ${mode === 'online' ? 'menu-nav__item--on' : ''}`.trim()}
        onClick={() => onSelectMode('online')}
        aria-current={mode === 'online' ? 'page' : undefined}
      >
        <UsersIcon size={16} aria-hidden />
        <span className="menu-nav__label">
          {t('online', 'multiplayer')}
          <small className="menu-nav__sub">{t('online', 'online2p')}</small>
        </span>
      </Button>

      <Button className="menu-nav__item menu-nav__item--tertiary" onClick={onOpenUnits}>
        <BookOpenIcon size={16} aria-hidden />
        <span className="menu-nav__label">{t('mainMenu', 'unitGuide')}</span>
      </Button>

      {/* Anchors, not `Button`s: these navigate, and they are the only links in
          the UI that leave the app. They carry `btn` by hand because that styling
          comes from the shared component every other rail entry goes through.

          Discord is offered in both builds — unlike the desktop download below,
          which the desktop build has no use for.

          Its plain left click is handled rather than followed, because the
          installed Discord client is the better destination when there is one
          and only `openDiscord` can find that out. The `href` stays the web
          invite, so every other way of using a link still works — and so does
          this one if scripting is having a bad day. */}
      <a
        className="btn menu-nav__item menu-nav__item--tertiary"
        href={DISCORD_INVITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          sfx.buttonClick();
          // A modified click means the player asked for something specific
          // (new tab, new window, download) — leave the browser to it.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          openDiscord();
        }}
      >
        <DiscordIcon size={16} aria-hidden />
        <span className="menu-nav__label">{t('mainMenu', 'discord')}</span>
      </a>

      {!isDesktopApp && (
        <a
          className="btn menu-nav__item menu-nav__item--tertiary"
          href={DESKTOP_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => sfx.buttonClick()}
        >
          <DownloadIcon size={16} aria-hidden />
          <span className="menu-nav__label">{t('mainMenu', 'desktopApp')}</span>
        </a>
      )}

      {/* The mirror of the link above: in a browser the rail offers the desktop
          build, in the desktop build it offers the way out of it. No confirmation
          — nothing is running here, and the title screen is where quitting is
          the ordinary thing to want. */}
      {isDesktopApp && (
        <Button className="menu-nav__item menu-nav__item--tertiary" onClick={quitDesktopApp}>
          <PowerIcon size={16} aria-hidden />
          <span className="menu-nav__label">{t('mainMenu', 'quit')}</span>
        </Button>
      )}
    </nav>
  );
}
