import { gameConfig } from '../../config/gameConfig';
import { useT } from '../../i18n';
import { ChassisType } from '../../types/enums';
import { Button } from '../common/Button';

const OPTIONS: ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

/** Single-select chassis chooser for the build flow. */
export function ChassisPicker({
  value,
  onChange,
}: {
  value: ChassisType;
  onChange: (chassis: ChassisType) => void;
}) {
  const t = useT();
  return (
    <div className="picker">
      {OPTIONS.map((chassis) => {
        const stats = gameConfig.robots.chassis[chassis];
        const hint = `${t('chassis', 'statsHp')}: ${stats.hp} · ${t('chassis', 'statsSpeed')}: ${stats.speed} · ${t('chassis', 'statsSight')}: ${stats.sight}`;
        return (
          <Button
            key={chassis}
            className={`chip ${chassis === value ? 'chip--on' : ''}`.trim()}
            onClick={() => onChange(chassis)}
            title={hint}
          >
            {t('chassis', chassis)}
          </Button>
        );
      })}
    </div>
  );
}
