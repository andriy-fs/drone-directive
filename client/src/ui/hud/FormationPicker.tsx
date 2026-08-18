import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import type { RobotSnapshot } from '../../store/types';
import { Button } from '../common/Button';
import {
  FORMATION_CHOICES,
  FORMATION_ICONS,
  type FormationChoice,
  formationHint,
  formationKey,
  formationLabels,
} from './formationOptions';

/**
 * Tiles that put the whole selection into one shape, as a single `SetFormation`
 * naming every id — unlike the directive grid above it, which sends one command
 * per robot. That difference is the feature: a formation is a fact about a
 * *group*, so the order has to arrive as one thing the engine can stamp a shared
 * group id on.
 *
 * Where each unit ends up inside the shape is not offered and never will be. The
 * engine derives it from the weapon (`FORMATION_RANK`), which is the whole reason
 * this is worth having: the player picks how much frontage to present, and the
 * jammer stops leading the charge without anybody dragging it into place.
 *
 * These tiles do carry tooltips, where the directive tiles deliberately don't:
 * what a shape costs is a decision made at the moment of clicking, not
 * background reading.
 */
export function FormationPicker({ robots }: { robots: RobotSnapshot[] }) {
  const t = useT();
  const enqueueCommand = useGameStore((s) => s.enqueueCommand);
  const labels = formationLabels(t);

  const idle = robots.length === 0;
  // Same rule as the directive grid: highlight only when the whole selection
  // already agrees, and read it off the (throttled) snapshot rather than
  // guessing optimistically — so the tile always shows the world, not the click.
  const current = !idle && robots.every((r) => r.formation === robots[0].formation) ? robots[0].formation : undefined;

  const assign = (choice: FormationChoice) => {
    enqueueCommand({ kind: 'SetFormation', robotIds: robots.map((r) => r.id), formation: choice });
  };

  return (
    <div className="tile-grid">
      {FORMATION_CHOICES.map((choice) => {
        const key = formationKey(choice);
        const Icon = FORMATION_ICONS[key];
        const on = current !== undefined && current === choice;
        return (
          <Button
            key={key}
            className={`tile ${on ? 'tile--on' : ''}`.trim()}
            aria-pressed={on}
            disabled={idle}
            title={formationHint(choice, t)}
            onClick={() => assign(choice)}
          >
            <Icon className="tile__icon" size={22} />
            <span>{labels[key]}</span>
          </Button>
        );
      })}
    </div>
  );
}
