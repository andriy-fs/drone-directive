import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { DroneMode } from '../../store/enums';
import { selectDroneStatus } from '../../store/selectors';
import { Bar } from '../common/Bar';

/**
 * The observer drone, all in one place: what it is doing, and how much of it is
 * left. The bar used to sit up in the Command panel, two sections above this
 * readout — the same subject reported in two places, with a "Observer drone"
 * caption repeating the heading it now lives under.
 *
 * Once it is shot down the same two slots change meaning rather than moving: the
 * status line reads as an alert and the bar tracks the replacement being built.
 */
function droneHealth(hp: number, maxHp: number): number {
  return maxHp > 0 ? hp / maxHp : 0;
}

export function DronePanel() {
  const t = useT();
  const drone = useGameStore(selectDroneStatus);
  const down = drone.mode === DroneMode.Down;

  let mode: string;
  if (down) mode = t('statusPanel', 'droneDown');
  else if (drone.mode === 'possessing') mode = t('hud', 'piloting');
  else mode = t('hud', 'observing');

  return (
    <div className={`drone-panel ${down ? 'drone-panel--down' : ''}`.trim()}>
      <p className="hud__status">{mode}</p>
      <Bar value={down ? drone.respawnProgress : droneHealth(drone.hp, drone.maxHp)} />
    </div>
  );
}
