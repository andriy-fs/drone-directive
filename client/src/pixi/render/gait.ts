/**
 * The walk-cycle clock for legged chassis, kept as a pure function so the phase
 * arithmetic can be tested without a renderer (the same reason `terrain/clusters.ts`
 * sits apart from `TerrainView`).
 *
 * **Driven by distance, not by time.** A time-driven cycle would need three separate
 * corrections that this needs none of: stopping it when the unit stops, scaling its
 * rate to the chassis speed, and slowing it down when the unit is grinding along at a
 * fraction of that speed because something is in the way. Distance answers all three
 * by construction — no travel, no step.
 */

/** One reading of the cycle: which cell to show, and where the body sits in its sway. */
export interface GaitPhase {
  /** Index into the sheet's cells, `0 … frames - 1`. Cell 0 is the neutral stance. */
  frame: number;
  /** Body sway, in `[-1, 1]`; one full period per cycle. Zero at the start of cell 0. */
  sway: number;
}

/**
 * Where `travelled` px of ground falls in a `stride`-px cycle of `frames` cells.
 *
 * `travelled` is expected to be a non-negative accumulator, but a negative value is
 * folded back into range rather than producing a negative index — JS `%` keeps the
 * sign of its left operand, and a negative index would silently hand the caller
 * `undefined` for a texture.
 */
export function gaitPhase(travelled: number, stride: number, frames: number): GaitPhase {
  const cycles = travelled / stride;
  const frame = Math.floor(cycles * frames) % frames;
  return {
    frame: frame < 0 ? frame + frames : frame,
    sway: Math.sin(cycles * Math.PI * 2),
  };
}
