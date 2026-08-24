/**
 * The clock for **timed** sprite cycles — a building's idle animation, a hovering
 * drone's — kept as a pure function so the phase arithmetic can be tested without a
 * renderer.
 *
 * **Deliberately separate from `gait.ts`.** That clock is driven by distance
 * travelled, and its docstring is an argument for why: the cycle stops when the unit
 * stops, scales itself to the chassis speed, and slows down when the unit is grinding
 * along behind something. None of that applies to a thing that animates while
 * standing still — a base never moves at all, and a drone hovering on the spot is
 * still running its rotors. For those, wall-clock time is the whole model.
 */

/**
 * Which cell of a `cells`-long cycle the moment `now` (ms) falls in.
 *
 * `period` is the length of one full cycle in ms; `phase` offsets the reading by that
 * many turns, which is how two of the same thing on screen are kept from pulsing in
 * lockstep. A negative result is folded back into range rather than returned as-is —
 * JS `%` keeps the sign of its left operand, and a negative index would silently hand
 * the caller `undefined` for a texture.
 */
export function cellAt(now: number, period: number, phase: number, cells: number): number {
  const cycles = now / period + phase;
  const cell = Math.floor(cycles * cells) % cells;
  return cell < 0 ? cell + cells : cell;
}
