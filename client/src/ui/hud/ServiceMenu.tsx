import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectDroneStatus } from '../../store/selectors';
import { DroneMode } from '../../store/enums';
import { Bar } from '../common/Bar';
import {
  OFFERED_OVERRIDES,
  OVERRIDE_ICONS,
  OVERRIDE_SECONDS,
  overrideLabels,
  overrideNotes,
  type OfferedOverride,
} from './overrideOptions';

/**
 * How long a row has to be held down before it arms (ms).
 *
 * There is no confirmation dialog and there is not going to be one — a modal over
 * a machine the player is currently *driving* is worse than the mistake it
 * prevents. The hold does the same job in the same gesture: a slip of the finger
 * costs nothing, and the fill reads as a physical toggle being pushed over,
 * which is what a service terminal should feel like.
 */
const HOLD_MS = 800;

/** What the finger is currently on, and how far it has got. */
interface Hold {
  kind: OfferedOverride;
  progress: number;
}

/**
 * The hull's service menu — the experimental modes, and the only part of the
 * interface that exists solely inside a possessed machine.
 *
 * **Mouse only, and nothing opens or closes it.** The panel is on screen for
 * exactly as long as a hull is being ridden, which is why there is no "menu is
 * open" flag in the store to keep in step with anything. Giving the rows number
 * keys would have put them against `useControlGroupHotkeys`, `Tab` would have
 * moved focus off the machine, and chat would have needed escaping — three
 * problems bought for a convenience that works against the feature anyway.
 * Reaching for the mouse takes a hand off `WASD`, and that is the point: arming a
 * mode costs the machine, so it should be a decision rather than a reflex.
 *
 * The keyboard deliberately keeps working while a row is held: `keydown` is bound
 * to `window` (`pixi/input/pointer.ts`), so the pilot can still steer and fire
 * with the other hand through the whole 0.8 s.
 *
 * The countdown *after* arming is not here — it is the fourth bar in
 * `pixi/render/fpv/instruments.ts`, drawn per frame. This panel rides the store
 * snapshot at 5 Hz, which is fine for a list that changes once a match and a
 * staircase for a clock a pilot times a detonation by.
 */
export function ServiceMenu() {
  const t = useT();
  const { mode, overrides } = useGameStore(selectDroneStatus);
  const requestOverride = useGameStore((s) => s.requestOverride);
  const [hold, setHold] = useState<Hold | null>(null);
  const frame = useRef(0);

  const possessing = mode === DroneMode.Possessing;

  const cancel = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    setHold(null);
  }, []);

  // A frame loop must never outlive the panel. Only the timer is torn down here —
  // no state is touched, because there is nothing left to render it.
  useEffect(() => {
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  const begin = useCallback(
    (kind: OfferedOverride) => {
      if (frame.current) cancelAnimationFrame(frame.current);
      const startedAt = performance.now();
      setHold({ kind, progress: 0 });
      const step = () => {
        // Losing the hull mid-hold drops the gesture. It is the one cancellation
        // the pointer cannot report — the machine can be shot out from under the
        // finger — so the loop asks the store itself rather than having an effect
        // mirror the answer into state it would then have to write during a
        // render pass.
        if (useGameStore.getState().droneStatus.mode !== DroneMode.Possessing) {
          frame.current = 0;
          setHold(null);
          return;
        }
        const progress = Math.min(1, (performance.now() - startedAt) / HOLD_MS);
        if (progress >= 1) {
          frame.current = 0;
          setHold(null);
          // The engine decides whether this is allowed; a refusal is silent and
          // costs the pilot nothing (`startOverride`).
          requestOverride(kind);
          return;
        }
        setHold({ kind, progress });
        frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    [requestOverride],
  );

  if (!possessing) return null;

  const labels = overrideLabels(t);
  const notes = overrideNotes(t);
  const busy = overrides.running !== null;

  return (
    <section className="service-menu" aria-label={t('serviceMenu', 'title')}>
      <h2 className="service-menu__title">{t('serviceMenu', 'title')}</h2>
      <p className="service-menu__warning">{t('serviceMenu', 'warning')}</p>
      <ul className="service-menu__list">
        {OFFERED_OVERRIDES.map((kind) => {
          const Icon = OVERRIDE_ICONS[kind];
          const offered = overrides.available.includes(kind);
          const enabled = offered && !busy;
          // Why a row is dark, rather than merely that it is: a hull without the
          // hardware and a hull already burning a mode are different situations,
          // and the player can act on one of them.
          const reason = !offered
            ? t('serviceMenu', 'unavailable')
            : busy
              ? t('serviceMenu', 'running')
              : null;
          const held = hold?.kind === kind ? hold.progress : 0;

          return (
            <li key={kind} className="service-menu__row">
              <button
                type="button"
                className="service-menu__button"
                disabled={!enabled}
                title={reason ?? notes[kind]}
                onPointerDown={() => enabled && begin(kind)}
                onPointerUp={cancel}
                onPointerLeave={cancel}
                onPointerCancel={cancel}
              >
                <Icon size={16} aria-hidden />
                <span className="service-menu__label">{labels[kind]}</span>
                <span className="service-menu__seconds">
                  {OVERRIDE_SECONDS[kind]}
                  {t('serviceMenu', 'seconds')}
                </span>
              </button>
              <Bar value={held} className="service-menu__hold" />
              <span className="service-menu__note">{reason ?? notes[kind]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
