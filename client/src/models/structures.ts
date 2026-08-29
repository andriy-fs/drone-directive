import { NodeKind, type Model } from './segment';
import { box, plate, tube } from './primitives';

/**
 * A base's building, without its launcher.
 *
 * Split in two because the two point different ways: a base is drawn square to the
 * world with only its turret rotated, which is what `base.heading` actually holds
 * (`taskSystem`'s turret pass writes it). Drawing them as one model would swing the
 * whole building round every time the battery tracked a target.
 */
export const BASE_BODY: Model = [
  ...box(96, 96, 0, 40),
  // A stepped upper block, so a base reads as a structure rather than a crate — and
  // so its far edge is still saying something after the fade has taken the rest.
  ...box(60, 60, 40, 62),
  ...plate(96, 96, 20),
];

/** The base's built-in missile battery, drawn at `base.heading` on top of the body. */
export const BASE_LAUNCHER: Model = [
  ...plate(22, 26, 62),
  ...tube(30, 9, 64, 74, 12, -7, NodeKind.Barrel),
  ...tube(30, 9, 64, 74, 12, 7, NodeKind.Barrel),
];
