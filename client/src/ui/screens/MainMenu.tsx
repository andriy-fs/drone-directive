import { Settings2Icon, HelpCircleIcon, BotIcon, Volume2Icon, VolumeXIcon } from '../common/icons';
import { useState, type CSSProperties } from 'react';
import { sfx } from '../../pixi/audio/sfx';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectOnline } from '../../store/selectors';
import { menuBackdropSrc } from '../../config/sprites';
import { Button } from '../common/Button';
import { ChipPicker, PickerGroup } from '../common/Picker';
import { BaseSetupModal } from './BaseSetupModal';
import { ControlsModal } from './ControlsModal';
import { OnlineLobby } from './OnlineLobby';
import { SoundSettingsModal } from './SoundSettingsModal';
import { UnitsGuideModal } from './UnitsGuideModal';
import { LANGUAGE_OPTIONS, difficultyOptions, mapSizeOptions, opponentOptions } from './menuOptions';

/** Which overlay the title screen is showing, or `null` for the menu itself. */
type MenuModal = 'setup' | 'controls' | 'units' | 'online' | 'sound' | null;

/**
 * Title screen: pick language/difficulty/roster, open Base Setup (auto-produce +
 * robot program) or the guides, then Start rebuilds the world with the chosen
 * settings. `App` mounts this only while the status is `menu`, which is what
 * keeps the dialog state below from surviving into (and out of) a match.
 *
 * Start does nothing here but raise the store's one-shot `restartRequested`;
 * consuming it — and beginning the match — is `GameApp.step()`'s job.
 */
export function MainMenu() {
  const t = useT();
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const mapSize = useGameStore((s) => s.settings.match.mapSize);
  const aiOpponents = useGameStore((s) => s.settings.match.aiOpponents);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const requestRestart = useGameStore((s) => s.requestRestart);
  const locale = useGameStore((s) => s.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const online = useGameStore(selectOnline);
  // One slot, not four flags: the menu's modals are alternatives, and letting
  // several be open at once means closing one reveals the next — with the lobby
  // forced open by `online.status`, that turns into a loop with no way out.
  const [modal, setModal] = useState<MenuModal>(null);
  const closeModal = () => setModal(null);

  // The lobby outranks the local toggle: a finished match leaves something to
  // report (`ended`/`error`), and that has to reach the player even if they
  // never opened the lobby themselves.
  const showOnline = modal === 'online' || online.status !== 'offline';

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
          in the same commit (returning here from a finished online match) the
          modal registers in Headless UI's stack first and the menu ends up "on
          top": the modal is painted but inert, and the menu behind it stays
          clickable. As a plain panel the menu sits inside #root, so an open
          modal inerts it the ordinary way. */}
      <div
        className="dialog-backdrop dialog-backdrop--splash"
        style={{ '--splash-image': `url(${menuBackdropSrc})` } as CSSProperties}
      />
      <div className="dialog-frame dialog-frame--menu">
        <div className="modal menu">
          <h1 className="menu__title">{t('mainMenu', 'title')}</h1>
          <p className="modal__body menu__intro">{t('mainMenu', 'intro')}</p>

          <PickerGroup label={t('mainMenu', 'language')}>
            <ChipPicker options={LANGUAGE_OPTIONS} value={locale} onChange={setLocale} />
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'difficulty')}>
            <ChipPicker
              options={difficultyOptions(t)}
              value={difficulty}
              onChange={(value) => updateSettings({ match: { difficulty: value } })}
            />
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'opponents')}>
            <ChipPicker
              options={opponentOptions(t)}
              value={aiOpponents}
              onChange={(value) => updateSettings({ match: { aiOpponents: value } })}
            />
          </PickerGroup>

          <PickerGroup label={t('mapSize', 'label')}>
            <ChipPicker
              options={mapSizeOptions(t)}
              value={mapSize}
              onChange={(value) => updateSettings({ match: { mapSize: value } })}
            />
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'baseSetup')}>
            <Button onClick={() => setModal('setup')}>
              <Settings2Icon size={16} /> {t('mainMenu', 'autoProduceProgram')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('sound', 'title')}>
            <Button onClick={() => setModal('sound')}>
              {sfx.isMuted() ? <VolumeXIcon size={16} /> : <Volume2Icon size={16} />} {t('sound', 'settings')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'help')}>
            <Button onClick={() => setModal('controls')}>
              <HelpCircleIcon size={16} /> {t('mainMenu', 'controls')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'units')}>
            <Button onClick={() => setModal('units')}>
              <BotIcon size={16} /> {t('mainMenu', 'unitGuide')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('online', 'multiplayer')}>
            <Button onClick={() => setModal('online')}>{t('online', 'online2p')}</Button>
          </PickerGroup>

          <Button className="modal__action" onClick={start}>
            {t('mainMenu', 'start')}
          </Button>
        </div>
      </div>

      {/* Exactly one of these, ever — see `modal` above. */}
      {showOnline ? (
        <OnlineLobby onClose={closeModal} />
      ) : modal === 'setup' ? (
        <BaseSetupModal onClose={closeModal} />
      ) : modal === 'units' ? (
        <UnitsGuideModal onClose={closeModal} />
      ) : modal === 'controls' ? (
        <ControlsModal onClose={closeModal} />
      ) : modal === 'sound' ? (
        <SoundSettingsModal onClose={closeModal} />
      ) : null}
    </>
  );
}
