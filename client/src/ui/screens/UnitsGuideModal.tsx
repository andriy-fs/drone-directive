import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { ChassisType, WeaponType } from '../../types/enums';
import { Button } from '../common/Button';
import { chassisHint, weaponHint } from '../hud/unitHints';

const CHASSIS_OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

const WEAPON_OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
];

/** Reference modal (opened from the main menu) listing every chassis/weapon with stats and a one-line advantage. */
export function UnitsGuideModal({ onClose }: { onClose: () => void }) {
  const t = useT();

  return (
    <Dialog open onClose={onClose}>
      <DialogBackdrop className="dialog-backdrop" />
      <div className="dialog-frame">
        <DialogPanel className="modal">
          <DialogTitle className="modal__title">{t('unitsGuide', 'title')}</DialogTitle>
          <p className="modal__body">{t('unitsGuide', 'intro')}</p>

          <span className="picker__label unit-guide__heading">{t('unitsGuide', 'chassisHeading')}</span>
          <div className="unit-guide">
            {CHASSIS_OPTIONS.map((chassis) => (
              <div className="unit-guide__item" key={chassis}>
                <span className="unit-guide__name">{t('chassis', chassis)}</span>
                <p className="unit-guide__stats">{chassisHint(chassis, t)}</p>
              </div>
            ))}
          </div>

          <span className="picker__label unit-guide__heading">{t('unitsGuide', 'weaponsHeading')}</span>
          <div className="unit-guide">
            {WEAPON_OPTIONS.map((weapon) => (
              <div className="unit-guide__item" key={weapon}>
                <span className="unit-guide__name">{t('weapons', weapon)}</span>
                <p className="unit-guide__stats">{weaponHint(weapon, t)}</p>
              </div>
            ))}
          </div>

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
