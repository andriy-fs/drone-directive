import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, DialogFrame } from '../common/Dialog';
import { useT } from '../../i18n';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { baseStats, chassisNote, chassisStats, weaponNote, weaponStats } from '../hud/unitHints';
import { CHASSIS_ICONS, WEAPON_ICONS } from '../hud/unitOptions';
import { baseSprites, robotSprites, weaponSprites } from '../../config/sprites';
import { gameConfig } from '../../config/gameConfig';
import type { LucideIcon } from '../common/icons';

const CHASSIS_OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

const WEAPON_OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
  WeaponType.Dew,
  WeaponType.Fpv,
];

/**
 * One entry: the player-faction sprite the unit is actually drawn with on the
 * field, so the reference and the battlefield are recognisably the same thing.
 * Weapons without art yet (they render as drawn markers) fall back to the same
 * glyph the build cards use, so a missing file leaves a tile rather than a hole.
 *
 * Unlike the build pickers, which have one line of tooltip room, the guide puts
 * the description first and the numbers on their own line under it — the joined
 * form runs too long here to read as anything but a wall.
 */
function GuideItem({
  src,
  Icon,
  name,
  note,
  stats,
}: {
  src?: string;
  Icon: LucideIcon;
  name: string;
  note: string;
  stats: string;
}) {
  return (
    <div className="unit-guide__item">
      {src ? (
        <img className="unit-guide__art" src={src} alt="" aria-hidden />
      ) : (
        <Icon className="unit-guide__art unit-guide__art--glyph" size={24} aria-hidden />
      )}
      <div>
        <span className="unit-guide__name">{name}</span>
        {note && <p className="unit-guide__note">{note}</p>}
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
      <DialogFrame>
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
                note={chassisNote(chassis, t)}
                stats={chassisStats(chassis, t)}
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
                note={weaponNote(weapon, t)}
                stats={weaponStats(weapon, t)}
              />
            ))}
          </div>

          {/* The base is not a buildable unit, but it shoots — and a player who
              only learns that by losing a drone to it has been ambushed by a
              rule, not outplayed. */}
          <span className="picker__label unit-guide__heading">{t('unitsGuide', 'baseHeading')}</span>
          <div className="unit-guide">
            <GuideItem
              src={baseSprites[Owner.Player]?.src}
              Icon={WEAPON_ICONS[gameConfig.bases.weapon]}
              name={t('unitsGuide', 'baseHeading')}
              note={t('unitsGuide', 'baseNote')}
              stats={baseStats(t)}
            />
          </div>

          <Button className="modal__action" onClick={onClose}>
            {t('mainMenu', 'close')}
          </Button>
        </DialogPanel>
      </DialogFrame>
    </Dialog>
  );
}
