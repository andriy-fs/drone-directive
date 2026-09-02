import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectDroneReadyNotice } from '../../store/selectors';
import { Button } from '../common/Button';

/** How long the toast stays up before it stops shouting (ms). */
const VISIBLE_MS = 6000;

/**
 * "Your new observer drone is up." The one thing the player has to be told when
 * a replacement is built, because deliberately nothing else moves: the camera
 * stays on whatever they were watching (see `GameApp.wireBus`), so without this
 * the rebuild is completely silent.
 *
 * Not a general notification system on purpose — there is no other event in the
 * game asking for one, and a generic toast queue would be infrastructure with a
 * single caller. It renders one flag.
 *
 * The toast times out, but the flag behind it does not: once the shouting stops
 * the Drone panel keeps the line and the pulsing toggle, so a player who was
 * looking elsewhere still finds out. Going to look at the drone clears it —
 * either from here, from the panel's tile, or by simply selecting it on the field.
 */
export function DroneReadyToast() {
  const t = useT();
  const notice = useGameStore(selectDroneReadyNotice);
  const requestShowDrone = useGameStore((s) => s.requestShowDrone);
  // Which notice has already had its say. Written only from the timer below —
  // visibility is *derived* from it rather than mirrored into another flag, so
  // nothing here has to write state during a render or an effect.
  const [expired, setExpired] = useState(0);

  useEffect(() => {
    if (notice === 0) return;
    const timer = window.setTimeout(() => setExpired(notice), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (notice === 0 || notice === expired) return null;

  return (
    <div className="drone-toast" role="status">
      <span className="drone-toast__text">{t('statusPanel', 'droneReadyToast')}</span>
      <Button className="drone-toast__action" onClick={requestShowDrone}>
        {t('statusPanel', 'droneReadyAction')}
      </Button>
    </div>
  );
}
