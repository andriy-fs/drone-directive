import { NodeKind, type Model } from './segment';
import { box, ring, seg, shift } from './primitives';

/**
 * A round in flight: one fat dash along its own path.
 *
 * Marked as a barrel node throughout, which is not a pun — it is drawn with the
 * heat pass, so it comes out warm and thick without a drawing path of its own. That
 * is also the right colour: a tracer belongs to nobody once it has left, and which
 * way it is going says whose it is far better than a tint would.
 *
 * Height comes from the model rather than the world, because a projectile is 2D in
 * the simulation — it has a position and a velocity and no altitude at all. Sitting
 * it at about a hull's deck is the reading that matches what fired it.
 */
export const PROJECTILE_MODEL: Model = [seg(-9, 0, 17, 9, 0, 17, NodeKind.Barrel)];

/**
 * A strike drone on its way in — a small delta at altitude, with the stem the
 * observer drone gets and for the same reason: nothing else in a wireframe says
 * "this one is flying".
 */
export const MUNITION_MODEL: Model = [
  seg(9, 0, 30, -6, 5, 30),
  seg(9, 0, 30, -6, -5, 30),
  seg(-6, 5, 30, -6, -5, 30),
  seg(0, 0, 30, 0, 0, 20),
];

/**
 * An observer drone, drawn well off the ground with a stem down to it.
 *
 * It is the one thing in this view that flies, and a wireframe has no shadow to say
 * so — the stem is what fixes it over a place instead of leaving it floating at an
 * unreadable distance. Unmarked throughout: a drone carries neither a weapon nor a
 * `movement` component, so there is no heat in the simulation to draw.
 */
export const DRONE_MODEL: Model = [
  ...box(20, 20, 34, 40),
  ...[-1, 1].flatMap((sx) =>
    [-1, 1].flatMap((sy) => ring(6, 41, 6).map((s) => shift(s, sx * 13, sy * 13))),
  ),
  seg(0, 0, 34, 0, 0, 10),
];
