/** Constrain `value` to the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Linear interpolation between a and b by t in [0, 1]. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Length of the vector `(dx, dy)` — deliberately `Math.sqrt`, never `Math.hypot`.
 *
 * A networked match is deterministic lockstep: both peers simulate the same
 * world from the same inputs and must agree bit for bit, yet they may be running
 * different JS engines. `Math.hypot` is not one operation but an algorithm — it
 * rescales its arguments to survive overflow/underflow — and every engine writes
 * that algorithm differently, so its last bit can disagree between browsers.
 * That is enough to drift two simulations apart and end the match on a desync.
 * `sqrt` is a single IEEE-754 operation required to be correctly rounded, and
 * `*`/`+` are exactly specified, so this form reproduces everywhere.
 *
 * The trade-off is the overflow guard we just gave up: `dx * dx` saturates to
 * Infinity past ~1.3e154. World coordinates are a few thousand pixels, so that
 * is unreachable here.
 */
export function vecLength(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Euclidean distance between two points. */
export function distance(ax: number, ay: number, bx: number, by: number): number {
  return vecLength(bx - ax, by - ay);
}
