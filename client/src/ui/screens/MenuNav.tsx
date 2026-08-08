import { useT } from '../../i18n';
import { Button } from '../common/Button';
import { BookOpenIcon, UserIcon, UsersIcon } from '../common/icons';

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
    </nav>
  );
}
