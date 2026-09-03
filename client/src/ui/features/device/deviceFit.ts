/**
 * Whether the screen in front of the player is one this game was built for, and
 * if not, which of the two answers they are owed.
 *
 * Pure on purpose — `(width, height) → verdict` and nothing else — so the
 * thresholds can be tested against the real device table without a browser (see
 * `deviceFit.test.ts`). `useDeviceFit.ts` beside it is the thin part that reads the
 * window and subscribes to its changes.
 *
 * **Measured against the viewport, not `window.screen`.** The size that matters
 * is the one the layout actually has to fit: an iPad in Split View has a
 * full-size screen and ~570px to draw in, and it is exactly the case a warning
 * is for. The cost of that choice is browser chrome — see the thresholds below.
 */

export const DeviceFit = {
  /** Big enough, and the right way round. */
  Ok: 'ok',
  /** Big enough, but stood on its end — one motion away from playable. */
  Rotate: 'rotate',
  /** Too small in any orientation. Rotating would not help, so do not ask for it. */
  TooSmall: 'too-small',
} as const;
export type DeviceFit = (typeof DeviceFit)[keyof typeof DeviceFit];

/**
 * The accepted device floor is an iPad mini — 1133 × 744 CSS px, landscape (see
 * `.docs/internal/tasks/support-tablets/README.md` § 4). Both numbers are
 * discounted here, because a *viewport* is never the screen it sits in:
 * landscape Safari on an iPad spends 60–90px of height on its own chrome, so an
 * iPad mini reporting ~655-685 would otherwise fail the very threshold it
 * defines.
 *
 * The discount lands on both bounds rather than on the height alone, because
 * which axis loses the chrome depends on how the device is being held: in
 * portrait the long side is the vertical one, and an iPad mini stood up reports
 * ~1050 rather than 1133.
 */
const SHORT_SIDE_MIN = 640;
const LONG_SIDE_MIN = 1000;

/**
 * Read as: is the *device* big enough (whichever way it is turned), and only
 * then, is it turned the right way?
 *
 * Sides rather than width/height, so the size verdict does not change under a
 * rotation — which is what lets a phone be told the truth ("too small") instead
 * of being sent round a loop where it rotates, is still too small, and is asked
 * to rotate back. It is also what keeps the phone-portrait viewport a crawler
 * renders showing the game behind a soft banner rather than a full-page block
 * (§ 4 again: `index.html` carries the canonical/OG/JSON-LD, and Google renders
 * mobile-first).
 */
export function deviceFit(width: number, height: number): DeviceFit {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < SHORT_SIDE_MIN || long < LONG_SIDE_MIN) return DeviceFit.TooSmall;
  return height > width ? DeviceFit.Rotate : DeviceFit.Ok;
}
