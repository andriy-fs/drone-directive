import { useState } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { buildCost } from '../../engine/economy';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectPlayerBase, selectResources } from '../../store/selectors';
import { ChassisType, TaskType, WeaponType } from '../../types/enums';
import { Button } from '../common/Button';
import { ChassisPicker } from './ChassisPicker';
import { ProgramPicker } from './ProgramPicker';
import { WeaponPicker } from './WeaponPicker';

/**
 * Configure a robot (chassis + weapon + program), then either build one such
 * robot ("Build Once" → BuildRobot) or start cyclic production of that same
 * model ("Set Auto-Build" → SetAutoBuild). The engine deducts cost and queues
 * production; the one-off button is disabled when unaffordable (the engine
 * re-checks affordability defensively).
 */
export function BuildRobotModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const playerBase = useGameStore(selectPlayerBase);
  // Seed from the base's current auto-build model so it reflects (and doesn't
  // accidentally reset) the running setting.
  const auto = playerBase?.autoBuild ?? null;
  const [chassis, setChassis] = useState<ChassisType>(auto?.chassis ?? ChassisType.Tracks);
  const [weapon, setWeapon] = useState<WeaponType>(auto?.weapon ?? WeaponType.Cannon);
  const [task, setTask] = useState<TaskType | null>(auto?.task ?? playerBase?.defaultTask ?? null);
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const resources = useGameStore(selectResources);

  const cost = buildCost({ chassis, weapon });
  const affordable = !!playerBase && resources.player >= cost;

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
        <DialogPanel className="modal" onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}>
          <DialogTitle className="modal__title">{t('buildRobot', 'title')}</DialogTitle>

          <div className="picker-group">
            <span className="picker__label">{t('buildRobot', 'chassis')}</span>
            <ChassisPicker value={chassis} onChange={setChassis} />
          </div>
          <div className="picker-group">
            <span className="picker__label">{t('buildRobot', 'weapon')}</span>
            <WeaponPicker value={weapon} onChange={setWeapon} />
          </div>
          <div className="picker-group">
            <span className="picker__label">{t('buildRobot', 'program')}</span>
            <ProgramPicker value={task} onChange={setTask} />
          </div>

          <p className="modal__body">
            {t('buildRobot', 'cost')} <strong>{cost}</strong> · {t('buildRobot', 'available')}{' '}
            {Math.floor(resources.player)}
          </p>

          <div className="modal__buttons">
            <Button onClick={onClose}>{t('buildRobot', 'cancel')}</Button>
            <Button onClick={setAutoBuild} disabled={!playerBase}>
              {t('buildRobot', 'setAutoBuild')}
            </Button>
            <Button onClick={build} disabled={!affordable}>
              {t('buildRobot', 'buildOnce')}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
