import { gameConfig } from '../../config/gameConfig';
import { useT, type T } from '../../i18n';
import { WeaponType } from '../../types/enums';
import { Button } from '../common/Button';

const OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
];

/** Range/damage (plus a note for non-combat weapons) for the picker's tooltip. */
function weaponHint(weapon: WeaponType, t: T): string {
  const stats = gameConfig.robots.weapons[weapon];
  const base = `${t('weapons', 'statsRange')}: ${stats.range} · ${t('weapons', 'statsDamage')}: ${stats.damage}`;
  switch (weapon) {
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

/** Single-select weapon chooser for the build flow. */
export function WeaponPicker({ value, onChange }: { value: WeaponType; onChange: (weapon: WeaponType) => void }) {
  const t = useT();
  return (
    <div className="picker">
      {OPTIONS.map((weapon) => (
        <Button
          key={weapon}
          className={`chip ${weapon === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(weapon)}
          title={weaponHint(weapon, t)}
        >
          {t('weapons', weapon)}
        </Button>
      ))}
    </div>
  );
}
