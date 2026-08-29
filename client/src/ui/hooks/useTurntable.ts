import { useEffect, useState } from 'react';

/** Seconds for one full revolution. Slow enough to read a machine, not so slow it looks stuck. */
const PERIOD_S = 12;

/**
 * Milliseconds between updates — about 30 a second.
 *
 * Every one of them re-renders the model, and a model is a few dozen SVG lines
 * whose endpoints all change: at display rate that is some twenty thousand
 * attribute writes a second, for a decoration. Half of them buy nothing a viewer
 * can see on a shape turning this slowly, and they were enough to starve the
 * typewriter running beside it.
 */
const FRAME_MS = 33;

/**
 * A bearing that goes slowly round, for a model on show (`common/Wireframe.tsx`).
 *
 * **Driven by the clock, not by a frame counter.** A `+= 0.01` per frame turns at
 * whatever rate the monitor happens to run at, which is two different speeds on two
 * different machines; reading elapsed time makes 144 Hz and 60 Hz show the same
 * revolution, with the faster one simply drawing more of it.
 *
 * Stops dead for a viewer who has asked their system for less motion — a preview
 * that spins forever in the corner of a dialog is exactly what that setting is
 * about — and unsubscribes on unmount, so a closed dialog costs nothing.
 */
export function useTurntable(active = true): number {
  const [spin, setSpin] = useState(0);

  useEffect(() => {
    if (!active) return;
    // Read once per mount rather than subscribed to: the dialog this drives is
    // open for seconds, and a viewer changing the system setting mid-dialog is not
    // worth a listener that every preview would carry.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const start = performance.now();
    let last = 0;
    const step = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        setSpin((((now - start) / 1000 / PERIOD_S) % 1) * Math.PI * 2);
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  return spin;
}
