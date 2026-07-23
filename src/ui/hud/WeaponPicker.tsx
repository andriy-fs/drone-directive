import { WeaponType } from '../../types/enums';
import { Button } from '../common/Button';

const OPTIONS: WeaponType[] = [
  WeaponType.None,
  WeaponType.Cannon,
  WeaponType.Missiles,
  WeaponType.Bomb,
  WeaponType.Radar,
];

/** Single-select weapon chooser for the build flow. */
export function WeaponPicker({
  value,
  onChange,
}: {
  value: WeaponType;
  onChange: (weapon: WeaponType) => void;
}) {
  return (
    <div className="picker">
      {OPTIONS.map((weapon) => (
        <Button
          key={weapon}
          className={`chip ${weapon === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(weapon)}
        >
          {weapon}
        </Button>
      ))}
    </div>
  );
}
