import { useT } from '../../i18n';
import { ChassisType } from '@drone-directive/types/enums';
import { Button } from '../common/Button';
import { chassisHint } from './unitHints';

const OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

/** Single-select chassis chooser for the build flow. */
export function ChassisPicker({ value, onChange }: { value: ChassisType; onChange: (chassis: ChassisType) => void }) {
  const t = useT();
  return (
    <div className="picker">
      {OPTIONS.map((chassis) => (
        <Button
          key={chassis}
          className={`chip ${chassis === value ? 'chip--on' : ''}`.trim()}
          onClick={() => onChange(chassis)}
          title={chassisHint(chassis, t)}
        >
          {t('chassis', chassis)}
        </Button>
      ))}
    </div>
  );
}
