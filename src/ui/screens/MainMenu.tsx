import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '../common/Dialog';
import { Settings2Icon, HelpCircleIcon } from '../common/icons';
import { useState } from 'react';
import { sfx } from '../../pixi/audio/sfx';
import { useGameStore } from '../../store/gameStore';
import { selectStatus } from '../../store/selectors';
import { Difficulty } from '../../types/enums';
import { Button } from '../common/Button';
import { BaseSetupModal } from './BaseSetupModal';

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  {
    value: Difficulty.Easy,
    label: 'Easy',
    hint: 'You start with one extra robot',
  },
  { value: Difficulty.Normal, label: 'Normal', hint: 'Even start' },
  {
    value: Difficulty.Hard,
    label: 'Hard',
    hint: 'The AI starts with one extra robot',
  },
];

/**
 * Title screen (shown while status is `menu`): pick difficulty, open Base Setup
 * (auto-produce + robot program, and future base options) via the gear button,
 * then Start rebuilds the world with the chosen settings.
 */
export function MainMenu() {
  const status = useGameStore(selectStatus);
  const difficulty = useGameStore((s) => s.settings.match.difficulty);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const requestRestart = useGameStore((s) => s.requestRestart);
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
          <DialogTitle className="menu__title">Drone Directive</DialogTitle>
          <p className="modal__body">
            Build robots, program their orders, and destroy the enemy base
            before it destroys yours.
          </p>

          <div className="picker-group">
            <span className="picker__label">Difficulty</span>
            <div className="picker">
              {DIFFICULTIES.map((o) => (
                <Button
                  key={o.value}
                  className={`chip ${o.value === difficulty ? 'chip--on' : ''}`.trim()}
                  onClick={() =>
                    updateSettings({ match: { difficulty: o.value } })
                  }
                  aria-label={o.hint}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="picker-group">
            <span className="picker__label">Base setup</span>
            <Button onClick={() => setSetupOpen(true)}>
              <Settings2Icon size={16} /> Auto-produce &amp; program
            </Button>
          </div>

          <div className="picker-group">
            <span className="picker__label">Help</span>
            <Button onClick={() => setControlsOpen(true)}>
              <HelpCircleIcon size={16} /> Controls
            </Button>
          </div>

          <Button className="modal__action" onClick={start}>
            Start
          </Button>
        </DialogPanel>
      </div>

      {setupOpen && <BaseSetupModal onClose={() => setSetupOpen(false)} />}

      {controlsOpen && (
        <Dialog open onClose={() => setControlsOpen(false)}>
          <DialogBackdrop className="dialog-backdrop" />
          <div className="dialog-frame">
            <DialogPanel className="modal">
              <DialogTitle className="modal__title">Controls</DialogTitle>
              <div className="modal__body">
                <div className="controls-list">
                  <div className="control-item">
                    <kbd>Ctrl + A</kbd>
                    <span>Select all robots</span>
                  </div>
                  <div className="control-item">
                    <kbd>Esc</kbd>
                    <span>Pause game</span>
                  </div>
                </div>

                <span className="picker__label controls-list__heading">Observer drone</span>
                <div className="controls-list">
                  <div className="control-item">
                    <kbd>W A S D</kbd>
                    <span>Fly the drone</span>
                  </div>
                  <div className="control-item">
                    <kbd>F</kbd>
                    <span>Land on / release an idle robot</span>
                  </div>
                  <div className="control-item">
                    <kbd>E</kbd>
                    <span>Fire the possessed robot's weapon</span>
                  </div>
                </div>
              </div>
              <Button
                className="modal__action"
                onClick={() => setControlsOpen(false)}
              >
                Close
              </Button>
            </DialogPanel>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
