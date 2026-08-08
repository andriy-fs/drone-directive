import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '../common/Dialog';
import { useT } from '../../i18n';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { chassisHint, weaponHint } from '../hud/unitHints';
import { CHASSIS_ICONS, WEAPON_ICONS } from '../hud/unitOptions';
import { robotSprites, weaponSprites } from '../../config/sprites';
import type { LucideIcon } from '../common/icons';

const CHASSIS_OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

const WEAPON_OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
  WeaponType.Dew,
];

/**
 * One entry: the player-faction sprite the unit is actually drawn with on the
 * field, so the reference and the battlefield are recognisably the same thing.
 * Weapons without art yet (they render as drawn markers) fall back to the same
 * glyph the build cards use, so a missing file leaves a tile rather than a hole.
 */
function GuideItem({ src, Icon, name, stats }: { src?: string; Icon: LucideIcon; name: string; stats: string }) {
  return (
    <div className="unit-guide__item">
      {src ? (
        <img className="unit-guide__art" src={src} alt="" aria-hidden />
      ) : (
        <Icon className="unit-guide__art unit-guide__art--glyph" size={24} aria-hidden />
      )}
      <div>
        <span className="unit-guide__name">{name}</span>
        <p className="unit-guide__stats">{stats}</p>
      </div>
    </div>
  );
}

/** Reference modal (opened from the main menu) listing every chassis/weapon with stats and a one-line advantage. */
export function UnitsGuideModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const chassisArt = robotSprites[Owner.Player];
  const weaponArt = weaponSprites[Owner.Player];

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
              <GuideItem
                key={chassis}
                src={chassisArt?.[chassis]?.src}
                Icon={CHASSIS_ICONS[chassis]}
                name={t('chassis', chassis)}
                stats={chassisHint(chassis, t)}
              />
            ))}
          </div>

          <span className="picker__label unit-guide__heading">{t('unitsGuide', 'weaponsHeading')}</span>
          <div className="unit-guide">
            {WEAPON_OPTIONS.map((weapon) => (
              <GuideItem
                key={weapon}
                src={weaponArt?.[weapon]?.src}
                Icon={WEAPON_ICONS[weapon]}
                name={t('weapons', weapon)}
                stats={weaponHint(weapon, t)}
              />
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
