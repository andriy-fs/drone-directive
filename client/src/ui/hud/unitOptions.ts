import { cardLabel } from '../common/cardLabel';
import type { ChipOption } from '../common/Picker';
import type { T } from '../../i18n';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import {
  BombIcon,
  BotIcon,
  CircleDashedIcon,
  EarIcon,
  type LucideIcon,
  RocketIcon,
  SatelliteDishIcon,
  TargetIcon,
  TruckIcon,
  ZapIcon,
} from '../common/icons';
import { chassisHint, weaponHint } from './unitHints';

/**
 * The build flow's chassis and weapon cards, in the active language — the same
 * shape as `programOptions.ts`, so the modals stay layout-only and "what can be
 * built" has one home.
 */

/** Glyph per chassis. Total, so adding a ChassisType can't leave a card blank. */
export const CHASSIS_ICONS: Record<ChassisType, LucideIcon> = {
  [ChassisType.Tracks]: TruckIcon,
  [ChassisType.Wheels]: CircleDashedIcon,
  [ChassisType.Legs]: BotIcon,
};

/** Glyph per weapon. Total for the same reason, including the unbuildable `None`. */
export const WEAPON_ICONS: Record<WeaponType, LucideIcon> = {
  [WeaponType.None]: CircleDashedIcon,
  [WeaponType.Cannon]: TargetIcon,
  [WeaponType.Missiles]: RocketIcon,
  [WeaponType.Bomb]: BombIcon,
  [WeaponType.Radar]: SatelliteDishIcon,
  [WeaponType.Ew]: EarIcon,
  [WeaponType.Dew]: ZapIcon,
};

const CHASSIS_OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

/** Everything but `None` — a robot the player orders always carries a payload. */
const WEAPON_OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
  WeaponType.Dew,
];

export function chassisOptions(t: T): ChipOption<ChassisType>[] {
  return CHASSIS_OPTIONS.map((chassis) => ({
    value: chassis,
    label: cardLabel(CHASSIS_ICONS[chassis], t('chassis', chassis)),
    hint: chassisHint(chassis, t),
  }));
}

export function weaponOptions(t: T): ChipOption<WeaponType>[] {
  return WEAPON_OPTIONS.map((weapon) => ({
    value: weapon,
    label: cardLabel(WEAPON_ICONS[weapon], t('weapons', weapon)),
    hint: weaponHint(weapon, t),
  }));
}
