import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '../common/Dialog';
import { Settings2Icon, HelpCircleIcon } from '../common/icons';
import { useState } from 'react';
import { sfx } from '../../pixi/audio/sfx';
import { useT, Locale } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectStatus } from '../../store/selectors';
import { Difficulty } from '../../types/enums';
import { Button } from '../common/Button';
import { BaseSetupModal } from './BaseSetupModal';

const DIFFICULTIES: {
  value: Difficulty;
  label: 'easy' | 'normal' | 'hard';
  hint: 'easyHint' | 'normalHint' | 'hardHint';
}[] = [
  { value: Difficulty.Easy, label: 'easy', hint: 'easyHint' },
  { value: Difficulty.Normal, label: 'normal', hint: 'normalHint' },
  { value: Difficulty.Hard, label: 'hard', hint: 'hardHint' },
];

const LANGUAGES: { value: Locale; label: string }[] = [
  { value: Locale.En, label: 'EN' },
  { value: Locale.Uk, label: 'UK' },
  { value: Locale.Pl, label: 'PL' },
  { value: Locale.Ru, label: 'RU' },
];

/**
 * Title screen (shown while status is `menu`): pick difficulty, open Base Setup
 * (auto-produce + robot program, and future base options) via the gear button,
 * then Start rebuilds the world with the chosen settings.
 */
export function MainMenu() {
  const t = useT();
  const status = useGameStore(selectStatus);
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const requestRestart = useGameStore((s) => s.requestRestart);
  const locale = useGameStore((s) => s.locale);
  const setLocale = useGameStore((s) => s.setLocale);
  const [setupOpen, setSetupOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  if (status !== 'menu') return null;

  const start = () => {
    sfx.resume();
    requestRestart(); // rebuild the world with the selected settings, then play
  };

  return (
    <Dialog open={status === 'menu'} onClose={() => undefined}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal menu">
          <DialogTitle className="menu__title">
            {t('mainMenu', 'title')}
          </DialogTitle>
          <p className="modal__body">{t('mainMenu', 'intro')}</p>

          <div className="picker-group">
            <span className="picker__label">{t('mainMenu', 'language')}</span>
            <div className="picker">
              {LANGUAGES.map((o) => (
                <Button
                  key={o.value}
                  className={`chip ${o.value === locale ? 'chip--on' : ''}`.trim()}
                  onClick={() => setLocale(o.value)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="picker-group">
            <span className="picker__label">{t('mainMenu', 'difficulty')}</span>
            <div className="picker">
              {DIFFICULTIES.map((o) => (
                <Button
                  key={o.value}
                  className={`chip ${o.value === difficulty ? 'chip--on' : ''}`.trim()}
                  onClick={() =>
                    updateSettings({ match: { difficulty: o.value } })
                  }
                  aria-label={t('difficulty', o.hint)}
                >
                  {t('difficulty', o.label)}
                </Button>
              ))}
            </div>
          </div>

          <div className="picker-group">
            <span className="picker__label">{t('mainMenu', 'baseSetup')}</span>
            <Button onClick={() => setSetupOpen(true)}>
              <Settings2Icon size={16} /> {t('mainMenu', 'autoProduceProgram')}
            </Button>
          </div>

          <div className="picker-group">
            <span className="picker__label">{t('mainMenu', 'help')}</span>
            <Button onClick={() => setControlsOpen(true)}>
              <HelpCircleIcon size={16} /> {t('mainMenu', 'controls')}
            </Button>
          </div>

          <Button className="modal__action" onClick={start}>
            {t('mainMenu', 'start')}
          </Button>
        </DialogPanel>
      </div>

      {setupOpen && <BaseSetupModal onClose={() => setSetupOpen(false)} />}

      {controlsOpen && (
        <Dialog open onClose={() => setControlsOpen(false)}>
          <DialogBackdrop className="dialog-backdrop" />
          <div className="dialog-frame">
            <DialogPanel className="modal">
              <DialogTitle className="modal__title">
                {t('mainMenu', 'controlsTitle')}
              </DialogTitle>
              <div className="modal__body">
                <div className="controls-list">
                  <div className="control-item">
                    <kbd>Ctrl + A</kbd>
                    <span>{t('mainMenu', 'ctrlA')}</span>
                  </div>
                  <div className="control-item">
                    <kbd>Esc</kbd>
                    <span>{t('mainMenu', 'esc')}</span>
                  </div>
                </div>

                <span className="picker__label controls-list__heading">
                  {t('mainMenu', 'droneHeading')}
                </span>
                <div className="controls-list">
                  <div className="control-item">
                    <kbd>W A S D</kbd>
                    <span>{t('mainMenu', 'flyDrone')}</span>
                  </div>
                  <div className="control-item">
                    <kbd>F</kbd>
                    <span>{t('mainMenu', 'landRelease')}</span>
                  </div>
                  <div className="control-item">
                    <kbd>E</kbd>
                    <span>{t('mainMenu', 'fireWeapon')}</span>
                  </div>
                </div>
              </div>
              <Button
                className="modal__action"
                onClick={() => setControlsOpen(false)}
              >
                {t('mainMenu', 'close')}
              </Button>
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
