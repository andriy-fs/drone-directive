import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { defaultBuildOrder } from '../../config/gameSettings';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { ChassisType, TaskType, WeaponType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { ChipPicker, PickerGroup } from '../common/Picker';
import { directiveOptions } from '../hud/programOptions';
import { chassisOptions, weaponOptions } from '../hud/unitOptions';

/**
 * Pre-game base configuration, opened from the gear on `BaseSetupRow`: the
 * auto-produced model and the initial program for produced robots — and the
 * place to grow further base settings.
 *
 * Whether auto-production runs at all is *not* asked here — that switch lives on
 * the row this dialog opens from, and having it in both places meant one setting
 * with two homes. What follows from that: applying a model is what turns
 * auto-production on, so opening the gear while it is off and pressing Apply
 * enables it (settings hold the model and its on/off as one nullable field).
 *
 * Everything is edited as a draft and committed in one write on Apply, so Cancel
 * — and Esc, and a click on the backdrop — genuinely discard.
 */
export function BaseSetupModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const updateSettings = useGameStore((s) => s.updateSettings);
  const base = useGameStore.getState().settings.base;

  const [chassis, setChassis] = useState<ChassisType>(base.autoBuild?.chassis ?? defaultBuildOrder.chassis);
  const [weapon, setWeapon] = useState<WeaponType>(base.autoBuild?.weapon ?? defaultBuildOrder.weapon);
  // The picker no longer offers "None", so seed it with a real directive; the
  // stored setting stays nullable because the domain still has that state.
  const [program, setProgram] = useState<TaskType>(base.defaultProgram ?? TaskType.Guard);

  const apply = () => {
    updateSettings({ base: { autoBuild: { chassis, weapon }, defaultProgram: program } });
    onClose();
  };

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel
          className="modal modal--wide"
          onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        >
          <DialogTitle className="modal__title">{t('baseSetup', 'title')}</DialogTitle>

          <PickerGroup label={t('baseSetup', 'chassis')}>
            <ChipPicker className="picker--cards" options={chassisOptions(t)} value={chassis} onChange={setChassis} />
          </PickerGroup>
          <PickerGroup label={t('baseSetup', 'weapon')}>
            <ChipPicker className="picker--cards" options={weaponOptions(t)} value={weapon} onChange={setWeapon} />
          </PickerGroup>

          <PickerGroup label={t('baseSetup', 'newRobotProgram')}>
            <ChipPicker<TaskType>
              className="picker--cards"
              options={directiveOptions(t)}
              value={program}
              onChange={setProgram}
            />
          </PickerGroup>

          <div className="modal__buttons modal__buttons--split">
            <Button className="btn--ghost" onClick={onClose}>
              {t('baseSetup', 'cancel')}
            </Button>
            <Button className="btn--primary" onClick={apply}>
              {t('baseSetup', 'apply')}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
