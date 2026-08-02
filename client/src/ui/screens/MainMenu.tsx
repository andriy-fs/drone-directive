import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { Settings2Icon, HelpCircleIcon, BotIcon } from '../common/icons';
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
import { UnitsGuideModal } from './UnitsGuideModal';
import { LANGUAGE_OPTIONS, difficultyOptions, mapSizeOptions, opponentOptions } from './menuOptions';

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
  const [setupOpen, setSetupOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [unitsOpen, setUnitsOpen] = useState(false);
  const [onlineOpen, setOnlineOpen] = useState(false);

  const start = () => {
    sfx.resume();
    requestRestart(); // rebuild the world with the selected settings, then play
  };

  return (
    <Dialog open onClose={() => undefined}>
      {/* The title screen's backdrop *is* the splash art: nothing of the world is
          built before Start, so this opaque, full-viewport layer is all there is
          behind the menu (see .docs/sprites/menu-backdrop.md). */}
      <DialogBackdrop
        className="dialog-backdrop dialog-backdrop--splash"
        style={{ '--splash-image': `url(${menuBackdropSrc})` } as CSSProperties}
      />
      <div className="dialog-frame">
        <DialogPanel className="modal menu">
          <DialogTitle className="menu__title">{t('mainMenu', 'title')}</DialogTitle>
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
            <Button onClick={() => setSetupOpen(true)}>
              <Settings2Icon size={16} /> {t('mainMenu', 'autoProduceProgram')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'help')}>
            <Button onClick={() => setControlsOpen(true)}>
              <HelpCircleIcon size={16} /> {t('mainMenu', 'controls')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('mainMenu', 'units')}>
            <Button onClick={() => setUnitsOpen(true)}>
              <BotIcon size={16} /> {t('mainMenu', 'unitGuide')}
            </Button>
          </PickerGroup>

          <PickerGroup label={t('online', 'multiplayer')}>
            <Button onClick={() => setOnlineOpen(true)}>{t('online', 'online2p')}</Button>
          </PickerGroup>

          <Button className="modal__action" onClick={start}>
            {t('mainMenu', 'start')}
          </Button>
        </DialogPanel>
      </div>

      {setupOpen && <BaseSetupModal onClose={() => setSetupOpen(false)} />}

      {unitsOpen && <UnitsGuideModal onClose={() => setUnitsOpen(false)} />}

      {(onlineOpen || online.status !== 'offline') && <OnlineLobby onClose={() => setOnlineOpen(false)} />}

      {controlsOpen && <ControlsModal onClose={() => setControlsOpen(false)} />}
    </Dialog>
  );
}
