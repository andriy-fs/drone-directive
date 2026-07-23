import { useEffect, useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { defaultBuildOrder } from '../../config/gameSettings';
import { useGameStore } from '../../store/gameStore';
import { ChassisType, WeaponType } from '../../types/enums';
import { Button } from '../common/Button';
import { ChassisPicker } from '../hud/ChassisPicker';
import { ProgramPicker } from '../hud/ProgramPicker';
import { WeaponPicker } from '../hud/WeaponPicker';

/**
 * Pre-game base configuration, opened from the main menu's gear button. Holds
 * the auto-produced model and the initial program for produced robots — and is
 * the place to grow further base settings. Writes straight to store settings.
 */
export function BaseSetupModal({ onClose }: { onClose: () => void }) {
  const defaultProgram = useGameStore((s) => s.settings.base.defaultProgram);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const initialAuto = useGameStore.getState().settings.base.autoBuild;

  const [autoOn, setAutoOn] = useState(initialAuto !== null);
  const [chassis, setChassis] = useState<ChassisType>(initialAuto?.chassis ?? defaultBuildOrder.chassis);
  const [weapon, setWeapon] = useState<WeaponType>(initialAuto?.weapon ?? defaultBuildOrder.weapon);

  // Keep the settings' auto-build model in sync with the local controls.
  useEffect(() => {
    updateSettings({ base: { autoBuild: autoOn ? { chassis, weapon } : null } });
  }, [autoOn, chassis, weapon, updateSettings]);

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal" onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
          <DialogTitle className="modal__title">Base Setup</DialogTitle>

          <div className="picker-group">
            <span className="picker__label">Auto-produce robots</span>
            <div className="picker">
              <Button
                className={`chip ${!autoOn ? 'chip--on' : ''}`.trim()}
                onClick={() => setAutoOn(false)}
              >
                Off
              </Button>
              <Button
                className={`chip ${autoOn ? 'chip--on' : ''}`.trim()}
                onClick={() => setAutoOn(true)}
              >
                On
              </Button>
            </div>
          </div>

          {autoOn && (
            <>
              <div className="picker-group">
                <span className="picker__label">Chassis</span>
                <ChassisPicker value={chassis} onChange={setChassis} />
              </div>
              <div className="picker-group">
                <span className="picker__label">Weapon</span>
                <WeaponPicker value={weapon} onChange={setWeapon} />
              </div>
            </>
          )}

          <div className="picker-group">
            <span className="picker__label">New robot program</span>
            <ProgramPicker
              value={defaultProgram}
              onChange={(task) => updateSettings({ base: { defaultProgram: task } })}
            />
          </div>

          <Button className="modal__action" onClick={onClose}>
            Done
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
