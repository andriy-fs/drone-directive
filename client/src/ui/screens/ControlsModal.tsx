import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT, type T } from '../../i18n';
import { Button } from '../common/Button';

/** One `keys → what they do` row; several `keys` render as separate <kbd>s. */
function ControlItem({ keys, action }: { keys: string[]; action: string }) {
  return (
    <div className="control-item">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
      <span>{action}</span>
    </div>
  );
}

function commandControls(t: T): { keys: string[]; action: string }[] {
  return [
    { keys: ['Ctrl + A'], action: t('mainMenu', 'ctrlA') },
    { keys: ['Esc'], action: t('mainMenu', 'esc') },
    { keys: ['Double-click'], action: t('mainMenu', 'dblClick') },
    { keys: ['Double-click'], action: t('mainMenu', 'dblClickBase') },
    { keys: ['Click'], action: t('mainMenu', 'selectBase') },
    { keys: ['Right-click'], action: t('mainMenu', 'setRally') },
    { keys: ['Right-click'], action: t('mainMenu', 'clearRally') },
    { keys: ['Ctrl + 1-9'], action: t('mainMenu', 'groupAssign') },
    { keys: ['1-9'], action: t('mainMenu', 'groupSelect') },
    { keys: ['W A S D', '↑ ← ↓ →'], action: t('mainMenu', 'panView') },
  ];
}

function droneControls(t: T): { keys: string[]; action: string }[] {
  return [
    // The eye is flown entirely with the pointer; the keys below are for the hull
    // it lands on, not for the drone itself.
    { keys: ['Click'], action: t('mainMenu', 'selectDrone') },
    { keys: ['Right-click'], action: t('mainMenu', 'sendDrone') },
    { keys: ['F'], action: t('mainMenu', 'landRelease') },
    // The one place the movement keys mean something other than the camera: on a
    // hull they are that machine's own controls — throttle along its nose and a
    // turn rate (`drivePossessed`). Worth its own row, but it needs no explaining
    // which job they are doing: the whole screen changes when you are inside one.
    { keys: ['W A S D', '↑ ← ↓ →'], action: t('mainMenu', 'steerHull') },
    { keys: ['E'], action: t('mainMenu', 'fireWeapon') },
  ];
}

/** Keyboard/mouse reference, opened from the title screen's Help row. */
export function ControlsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('mainMenu', 'controlsTitle')}</DialogTitle>
          <div className="modal__body">
            <div className="controls-list">
              {commandControls(t).map((row) => (
                <ControlItem key={row.action} {...row} />
              ))}
            </div>

            <span className="picker__label controls-list__heading">{t('mainMenu', 'droneHeading')}</span>
            <div className="controls-list">
              {droneControls(t).map((row) => (
                <ControlItem key={row.action} {...row} />
              ))}
            </div>
          </div>
          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
