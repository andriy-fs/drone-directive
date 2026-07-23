import { useT } from '../../i18n';
import { WeaponType } from '../../types/enums';
import { Button } from '../common/Button';

const OPTIONS: WeaponType[] = [
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
  WeaponType.Ew,
];

/** Single-select weapon chooser for the build flow. */
export function WeaponPicker({
  value,
  onChange,
}: {
  value: WeaponType;
  onChange: (weapon: WeaponType) => void;
}) {
  const t = useT();
  return (
    <div className="picker">
      {OPTIONS.map((weapon) => (
        <Button
          key={weapon}
          className={`chip ${weapon === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(weapon)}
        >
          {t('weapons', weapon)}
        </Button>
      ))}
    </div>
  );
}
