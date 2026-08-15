import { useEffect, useState, type CSSProperties } from 'react';
import { music } from '../../pixi/audio/music';
import { sfx } from '../../pixi/audio/sfx';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { OnlineStatus } from '../../store/enums';
import { selectOnline } from '../../store/selectors';
import { menuBackdropSrc } from '../../config/sprites';
import { BaseSetupModal } from './BaseSetupModal';
import { ControlsModal } from './ControlsModal';
import { GlobalSettingsBar } from './GlobalSettingsBar';
import { MatchSetupPanel } from './MatchSetupPanel';
import { MenuNav, type MenuMode } from './MenuNav';
import { OnlinePanel } from './OnlinePanel';
import { GraphicsSettingsModal } from './GraphicsSettingsModal';
import { SoundSettingsModal } from './SoundSettingsModal';
import { UnitsGuideModal } from './UnitsGuideModal';

/** Which overlay the title screen is showing, or `null` for the menu itself. */
type MenuModal = 'setup' | 'controls' | 'units' | 'sound' | 'graphics' | null;

/**
 * Title screen. Three zones rather than one list: global preferences (language,
 * sound, help) as an icon bar in the header, what kind of game you want in the
 * left rail, and that game's own setup — plus its primary action — in the right
 * column.
 *
 * The split is the whole point of the layout: app-wide settings and match rules
 * used to sit in the same vertical stack, which made them look like the same
 * kind of choice and pushed Start below nine rows of controls.
 *
 * This component owns the mode, the modal slot and the music; every setting is
 * read and written by the panel that shows it. Start does nothing here but raise
 * the store's one-shot `restartRequested` — consuming it, and beginning the
 * match, is `GameApp.step()`'s job.
 */
export function MainMenu() {
  const t = useT();
  const requestRestart = useGameStore((s) => s.requestRestart);
  const leaveOnline = useGameStore((s) => s.leaveOnline);
  const online = useGameStore(selectOnline);
  const [requestedMode, setRequestedMode] = useState<MenuMode>('single');
  // One slot, not four flags: the menu's modals are alternatives, and letting
  // several be open at once means closing one reveals the next.
  const [modal, setModal] = useState<MenuModal>(null);
  const closeModal = () => setModal(null);

  // The music runs for exactly as long as this component does. `App` mounts the
  // menu only while the status is `menu`, so the mount/unmount pair already
  // means "the title screen is/isn't on screen" — including the way back from a
  // finished match. Nothing here waits for Start: the context is usually still
  // suspended at mount, and `music` retries itself on the first gesture.
  useEffect(() => {
    music.startMenu();
    return () => music.stopMenu();
  }, []);

  // A live session outranks the tab the player last pressed: a finished match
  // leaves something to report (`ended`/`error`), and that has to reach them even
  // if they never opened the panel themselves — which is the case coming back
  // here from an online match. Derived rather than an effect, so there is no
  // frame where the menu shows Singleplayer over a session that still exists.
  const mode: MenuMode = online.status === OnlineStatus.Offline ? requestedMode : 'online';

  // Leaving the tab is leaving the session — the same thing the lobby's Close
  // used to do. Without this, `mode` above would simply pin the player back.
  const selectMode = (next: MenuMode) => {
    if (next === 'single' && online.status !== OnlineStatus.Offline) leaveOnline();
    setRequestedMode(next);
  };

  const start = () => {
    sfx.resume();
    requestRestart(); // rebuild the world with the selected settings, then play
  };

  return (
    <>
      {/* Deliberately NOT a Headless UI Dialog. The title screen can't be closed
          (no Escape, no click-outside), so it gained nothing from one — while
          being a dialog made every modal below a *nested* dialog. React runs a
          child's effects before its parent's, so when the menu and a modal mount
          in the same commit the modal registers in Headless UI's stack first and
          the menu ends up "on top": the modal is painted but inert, and the menu
          behind it stays clickable. As a plain panel the menu sits inside #root,
          so an open modal inerts it the ordinary way.

          The online lobby used to be that same-commit modal — forced open by a
          non-`offline` status while the menu mounted. It is a panel now (see
          `OnlinePanel`), which is why nothing below opens by itself. */}
      <div
        className="dialog-backdrop dialog-backdrop--splash"
        style={{ '--splash-image': `url(${menuBackdropSrc})` } as CSSProperties}
      />
      <div className="dialog-frame dialog-frame--menu">
        <div className="menu-shell">
          <header className="menu-shell__header">
            <h1 className="menu__title">{t('mainMenu', 'title')}</h1>
            <GlobalSettingsBar
              onOpenSound={() => setModal('sound')}
              onOpenGraphics={() => setModal('graphics')}
              onOpenControls={() => setModal('controls')}
            />
          </header>

          <div className="menu-shell__body">
            <MenuNav mode={mode} onSelectMode={selectMode} onOpenUnits={() => setModal('units')} />
            {mode === 'online' ? (
              <OnlinePanel onOpenBaseSetup={() => setModal('setup')} />
            ) : (
              <MatchSetupPanel onOpenBaseSetup={() => setModal('setup')} onStart={start} />
            )}
          </div>
        </div>
      </div>

      {/* Exactly one of these, ever — see `modal` above. */}
      {modal === 'setup' ? (
        <BaseSetupModal onClose={closeModal} />
      ) : modal === 'units' ? (
        <UnitsGuideModal onClose={closeModal} />
      ) : modal === 'controls' ? (
        <ControlsModal onClose={closeModal} />
      ) : modal === 'sound' ? (
        <SoundSettingsModal onClose={closeModal} />
      ) : modal === 'graphics' ? (
        <GraphicsSettingsModal onClose={closeModal} />
      ) : null}
    </>
  );
}
