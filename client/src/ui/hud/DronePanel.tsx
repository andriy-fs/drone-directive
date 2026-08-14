import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { DroneMode } from '../../store/enums';
import { selectDroneReadyNotice, selectDroneStatus, selectViewSync } from '../../store/selectors';
import { Bar } from '../common/Bar';
import { Button } from '../common/Button';

/**
 * The observer drone, all in one place: what it is doing, and how much of it is
 * left. The bar used to sit up in the Command panel, two sections above this
 * readout — the same subject reported in two places, with a "Observer drone"
 * caption repeating the heading it now lives under.
 *
 * Once it is shot down the same two slots change meaning rather than moving: the
 * status line reads as an alert and the bar tracks the replacement being built.
 *
 * The toggle underneath is the other half of that story. A replacement always
 * rolls out over the base, so the view is cut loose the moment the drone dies
 * and stays loose — the player is told a new one is up and decides when to go
 * back to it, instead of being hauled off the fight they were watching.
 */
function droneHealth(hp: number, maxHp: number): number {
  return maxHp > 0 ? hp / maxHp : 0;
}

export function DronePanel() {
  const t = useT();
  const drone = useGameStore(selectDroneStatus);
  const synced = useGameStore(selectViewSync);
  const ready = useGameStore(selectDroneReadyNotice) > 0;
  const setViewSync = useGameStore((s) => s.setViewSync);
  const down = drone.mode === DroneMode.Down;

  // Four states over three sources, most urgent first: no drone at all, a new
  // one waiting to be looked at, a live one the view has been cut loose from,
  // and the two ordinary flying modes.
  let mode: string;
  if (down) mode = t('statusPanel', 'droneDown');
  else if (ready) mode = t('statusPanel', 'droneReady');
  else if (!synced) mode = t('statusPanel', 'droneFreeView');
  else if (drone.mode === DroneMode.Possessing) mode = t('hud', 'piloting');
  else mode = t('hud', 'observing');

  const stateClass = down ? 'drone-panel--down' : ready ? 'drone-panel--ready' : '';

  return (
    <div className={`drone-panel ${stateClass}`.trim()}>
      <p className="hud__status">{mode}</p>
      <Bar value={down ? drone.respawnProgress : droneHealth(drone.hp, drone.maxHp)} />
      <Button
        className={`drone-panel__sync ${ready ? 'drone-panel__sync--ready' : ''}`.trim()}
        // Nothing to sync to while it is being rebuilt; the view is already free.
        disabled={down}
        aria-pressed={synced}
        title={t('hud', 'viewSyncHint')}
        onClick={() => setViewSync(!synced)}
      >
        {synced ? t('hud', 'viewDrone') : t('hud', 'viewFree')}
      </Button>
    </div>
  );
}
