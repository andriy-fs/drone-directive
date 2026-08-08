import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { buildCost } from '../../engine/economy';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectLocalSide, selectPlayerBase, selectResources } from '../../store/selectors';
import { ChassisType, TaskType, WeaponType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { XIcon } from '../common/icons';
import { ChipPicker, PickerGroup } from '../common/Picker';
import { directiveOptions } from './programOptions';
import { chassisOptions, weaponOptions } from './unitOptions';

/**
 * Configure a robot (chassis + weapon + directive), then either build one such
 * robot ("Build Once" → BuildRobot) or start cyclic production of that same
 * model ("Set Auto-Build" → SetAutoBuild). The engine deducts cost and queues
 * production; the one-off button is disabled when unaffordable (the engine
 * re-checks affordability defensively).
 */
export function BuildRobotModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const playerBase = useGameStore(selectPlayerBase);
  // Seed from the base's current auto-build model so it reflects (and doesn't
  // accidentally reset) the running setting. Unlike the pre-game setting, this
  // dialog offers no "no directive" card, so it falls back to Guard rather than
  // to null — a robot ordered here always leaves with a standing order.
  const auto = playerBase?.autoBuild ?? null;
  const [chassis, setChassis] = useState<ChassisType>(auto?.chassis ?? ChassisType.Tracks);
  const [weapon, setWeapon] = useState<WeaponType>(auto?.weapon ?? WeaponType.Cannon);
  const [task, setTask] = useState<TaskType>(auto?.task ?? playerBase?.defaultTask ?? TaskType.Guard);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const resources = useGameStore(selectResources);
  const localSide = useGameStore(selectLocalSide);

  const cost = buildCost({ chassis, weapon });
  // The local side's own wallet — the online guest plays `Owner.AI`, so reading
  // `resources.player` here would gate them on their opponent's balance.
  const wallet = resources[localSide] ?? 0;
  const affordable = !!playerBase && wallet >= cost;

  const build = () => {
    if (!playerBase || !affordable) return;
    enqueueCommand({ kind: 'BuildRobot', baseId: playerBase.id, order: { chassis, weapon, task } });
    onClose();
  };

  const setAutoBuild = () => {
    if (!playerBase) return;
    enqueueCommand({ kind: 'SetAutoBuild', baseId: playerBase.id, order: { chassis, weapon, task } });
    onClose();
  };

  return (
    <Dialog open={true} onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel
          className="modal modal--build"
          onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        >
          <div className="modal__head">
            <DialogTitle className="modal__title">{t('buildRobot', 'title')}</DialogTitle>
            <Button className="modal__close" onClick={onClose} aria-label={t('aria', 'close')} title={t('aria', 'close')}>
              <XIcon size={16} aria-hidden />
            </Button>
          </div>

          <PickerGroup label={t('buildRobot', 'chassis')}>
            <ChipPicker className="picker--cards" options={chassisOptions(t)} value={chassis} onChange={setChassis} />
          </PickerGroup>
          <PickerGroup label={t('buildRobot', 'weapon')}>
            <ChipPicker className="picker--cards" options={weaponOptions(t)} value={weapon} onChange={setWeapon} />
          </PickerGroup>
          <PickerGroup label={t('buildRobot', 'program')}>
            <ChipPicker className="picker--cards" options={directiveOptions(t)} value={task} onChange={setTask} />
          </PickerGroup>

          <div className="build-cost">
            <div className="build-cost__stat">
              <span className="build-cost__label">{t('buildRobot', 'cost')}</span>
              {/* Red is the whole explanation for the disabled Build Once below. */}
              <span className={`build-cost__value ${affordable ? '' : 'build-cost__value--short'}`.trim()}>{cost}</span>
            </div>
            <div className="build-cost__stat">
              <span className="build-cost__label">{t('buildRobot', 'available')}</span>
              <span className="build-cost__value">{Math.floor(wallet)}</span>
            </div>
          </div>

          <div className="modal__buttons modal__buttons--split">
            <Button className="btn--ghost" onClick={onClose}>
              {t('buildRobot', 'cancel')}
            </Button>
            <Button onClick={setAutoBuild} disabled={!playerBase}>
              {t('buildRobot', 'setAutoBuild')}
            </Button>
            <Button className="btn--primary" onClick={build} disabled={!affordable}>
              {t('buildRobot', 'buildOnce')}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
