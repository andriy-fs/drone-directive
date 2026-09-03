import { useEffect, useState } from 'react';
import { deviceFit, type DeviceFit } from './deviceFit';

const read = (): DeviceFit => deviceFit(window.innerWidth, window.innerHeight);

/**
 * The current screen's verdict, kept live.
 *
 * Subscribed rather than read once (unlike `useTurntable`'s reduced-motion
 * check): every one of the three cases this exists for is a thing that happens
 * *while* the page is open — a tablet is rotated, a Split View divider is
 * dragged, a desktop window is resized.
 *
 * `resize` rather than a `matchMedia` query, now that the measurement is the
 * viewport: one listener covers all three, where media queries would need a
 * query per bound and would still miss nothing the resize does not. It fires
 * freely during a window drag, and that is harmless — the verdict is one of
 * three strings, so an unchanged one is the same primitive and React re-renders
 * nothing. `orientationchange` is kept alongside it because iOS has historically
 * reported the new size late on rotation, and a second read costs nothing.
 */
export function useDeviceFit(): DeviceFit {
  const [fit, setFit] = useState(read);

  useEffect(() => {
    const update = () => setFit(read());
    // A rotation that lands between the first render and this effect would
    // otherwise show a stale verdict until the next resize.
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return fit;
}
