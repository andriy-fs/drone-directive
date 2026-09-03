import type { FederatedPointerEvent } from 'pixi.js';
import { isDrag } from './pointer';

/**
 * Run `fn` when the finger that produced `e` lifts, and only if it lifted where
 * it went down — i.e. only if the press was a tap and not a drag.
 *
 * **Anything that opens a DOM dialog from a Pixi `pointerdown` has to come
 * through here.** Headless UI dismisses a dialog on the first `touchend` outside
 * its panel, and on a mobile user agent it never pairs that `touchend` with a
 * `touchstart` (`@headlessui/react`, `use-outside-click.js`: the
 * `pointerdown`/`pointerup` pairing that makes the desktop path safe is skipped
 * there). So a dialog mounted during `pointerdown` is closed again by the very tap that opened it —
 * the `touchend` arrives after React has mounted it. Waiting for the
 * lift puts the mount in the same phase a HUD button's `click` already runs in,
 * which is why buttons never had the problem.
 *
 * `touchcancel` drops the callback: a press the browser took away (promoted to a
 * scroll, or joined by a second finger into a pinch) must not open anything —
 * and must not leave a listener behind to fire on somebody else's tap.
 */
export function runAfterTouch(e: FederatedPointerEvent, fn: () => void): void {
  const x0 = e.client.x;
  const y0 = e.client.y;

  const onEnd = (ev: TouchEvent) => {
    stop();
    const t = ev.changedTouches[0];
    // No touch to measure means no evidence this was a tap; the same coordinate
    // space on both ends (client px), since `e.global` is the canvas's.
    if (t && !isDrag(x0, y0, t.clientX, t.clientY, 'touch')) fn();
  };
  const onCancel = () => stop();

  function stop(): void {
    window.removeEventListener('touchend', onEnd);
    window.removeEventListener('touchcancel', onCancel);
  }

  window.addEventListener('touchend', onEnd, { once: true });
  window.addEventListener('touchcancel', onCancel, { once: true });
}
