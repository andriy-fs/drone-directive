import { gameConfig } from '../../config/gameConfig';
import type { T } from '../../i18n';
import { ChassisType, WeaponType } from '../../types/enums';

const CHASSIS_NOTES: Record<ChassisType, 'tracksNote' | 'wheelsNote' | 'legsNote'> = {
  tracks: 'tracksNote',
  wheels: 'wheelsNote',
  legs: 'legsNote',
};

/** Stats plus a one-line advantage note — used for the chassis picker's tooltip and the unit guide. */
export function chassisHint(chassis: ChassisType, t: T): string {
  const stats = gameConfig.robots.chassis[chassis];
  const base = `${t('chassis', 'statsHp')}: ${stats.hp} · ${t('chassis', 'statsSpeed')}: ${stats.speed} · ${t('chassis', 'statsSight')}: ${stats.sight}`;
  return `${base} — ${t('chassis', CHASSIS_NOTES[chassis])}`;
}

/** Stats plus a one-line advantage note — used for the weapon picker's tooltip and the unit guide. */
export function weaponHint(weapon: WeaponType, t: T): string {
  const stats = gameConfig.robots.weapons[weapon];
  const base = `${t('weapons', 'statsRange')}: ${stats.range} · ${t('weapons', 'statsDamage')}: ${stats.damage}`;
  switch (weapon) {
    case WeaponType.Cannon:
      return `${base} — ${t('weapons', 'cannonNote')}`;
    case WeaponType.Missiles:
      return `${base} — ${t('weapons', 'missilesNote')}`;
    case WeaponType.Bomb:
      return `${base} (${t('weapons', 'bombNote')} ${stats.explosionRadius}px)`;
    case WeaponType.Radar:
      return `${base} — ${t('weapons', 'radarNote')}`;
    case WeaponType.Ew:
      return `${base} — ${t('weapons', 'ewNote')} ${stats.jamRadius}px`;
    default:
      return base;
  }
}
