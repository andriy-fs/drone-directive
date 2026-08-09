import { gameConfig } from '../../config/gameConfig';
import type { T } from '../../i18n';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * The two halves of a unit blurb, kept separate because the two places that show
 * it want different shapes: the build pickers have one line of tooltip room and
 * take the joined `…Hint`, while the units guide stacks the description over the
 * numbers so neither has to be skimmed past to reach the other.
 */

const CHASSIS_NOTES: Record<ChassisType, 'tracksNote' | 'wheelsNote' | 'legsNote'> = {
  tracks: 'tracksNote',
  wheels: 'wheelsNote',
  legs: 'legsNote',
};

/** The numbers alone: HP · speed · sight. */
export function chassisStats(chassis: ChassisType, t: T): string {
  const stats = gameConfig.robots.chassis[chassis];
  return `${t('chassis', 'statsHp')}: ${stats.hp} · ${t('chassis', 'statsSpeed')}: ${stats.speed} · ${t('chassis', 'statsSight')}: ${stats.sight}`;
}

/** The one-line advantage note alone. */
export function chassisNote(chassis: ChassisType, t: T): string {
  return t('chassis', CHASSIS_NOTES[chassis]);
}

/** Stats plus the note on one line — the chassis picker's tooltip. */
export function chassisHint(chassis: ChassisType, t: T): string {
  return `${chassisStats(chassis, t)} — ${chassisNote(chassis, t)}`;
}

/**
 * The numbers alone: range · damage — except `dew`, which deals none. "Damage: 0"
 * would read as broken, so it shows what it actually trades on: reach and the
 * long reload (how long the target stays down is part of its note).
 */
export function weaponStats(weapon: WeaponType, t: T): string {
  const stats = gameConfig.robots.weapons[weapon];
  if (weapon === WeaponType.Dew) {
    return `${t('weapons', 'statsRange')}: ${stats.range} · ${t('weapons', 'statsReload')}: ${stats.cooldown}`;
  }
  return `${t('weapons', 'statsRange')}: ${stats.range} · ${t('weapons', 'statsDamage')}: ${stats.damage}`;
}

/** The descriptive note alone, including any radius/duration it ends on. */
export function weaponNote(weapon: WeaponType, t: T): string {
  const stats = gameConfig.robots.weapons[weapon];
  switch (weapon) {
    case WeaponType.Cannon:
      return t('weapons', 'cannonNote');
    case WeaponType.Missiles:
      return t('weapons', 'missilesNote');
    case WeaponType.Bomb:
      return `${t('weapons', 'bombNote')} ${stats.explosionRadius}px`;
    case WeaponType.Radar:
      return t('weapons', 'radarNote');
    case WeaponType.Ew:
      return `${t('weapons', 'ewNote')} ${stats.jamRadius}px`;
    case WeaponType.Dew:
      return `${t('weapons', 'dewNote')} ${stats.freezeDuration}`;
    default:
      return '';
  }
}

/** Stats plus the note on one line — the weapon picker's tooltip. */
export function weaponHint(weapon: WeaponType, t: T): string {
  const note = weaponNote(weapon, t);
  const stats = weaponStats(weapon, t);
  return note ? `${stats} — ${note}` : stats;
}
