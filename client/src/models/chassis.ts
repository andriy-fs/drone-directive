import { ChassisType } from '@drone-directive/types/enums';
import { NodeKind, type Model } from './segment';
import { box, seg, wheel } from './primitives';

/**
 * The three drives, as outlines.
 *
 * ## What these are drawn against
 *
 * The sprites, not the collision radius. A robot is 46 px of art on the field
 * (`config/sprites.ts`), 52 for the walker, and a weapon module is 30 px on every
 * chassis — so a player who has learned to tell a walker from a buggy from above
 * reads the same proportions from inside one. The briefs in
 * `.docs/internal/sprites/robots.md` and `weapons.md` are what each model quotes:
 * the tank is a lid on two bands, the buggy is a hull on four exposed tires, the
 * walker is a wide body carried high on six short legs. Dimensions differ by a few
 * px where a wireframe needs the room; identities do not differ at all.
 *
 * ## Node marks
 *
 * A marked segment is drawn twice — once as structure, once more in the heat colour
 * at whatever the renderer says that node is running at. **Nothing new is needed
 * from the simulation for that**: `weapon.cooldownLeft / weapon.cooldown` already
 * means "just fired", and `movement.velX/velY` against `movement.speed` already
 * means "driving hard". The marks are only the map from those two numbers to the
 * parts of the machine they belong to.
 */

/**
 * A chassis: its outline, and the height a weapon module bolts on at.
 *
 * The deck is what keeps the two tables independent. A module is authored once,
 * flat at `z = 0`, and lifted onto whichever hull it is fitted to — which is exactly
 * what the art does with a fixed 30 px module on three differently sized chassis.
 */
export interface Chassis {
  hull: Model;
  /** Height (px) of the hardpoint the weapon module sits on. */
  deck: number;
}

/**
 * Heavy tracked tank: a lid on two bands.
 *
 * The bands are the silhouette and the hull is the thing they carry, which is the
 * shape the sprite brief insists on ("the hull is a lid"). The cross links on the
 * top run are the marked wheels: on a real tank the top run is the only one this
 * camera can see, and it travels forward at the hull's own speed — so it is also
 * the honest place to put drive heat.
 */
const TRACKS: Chassis = {
  deck: 17,
  hull: [
    ...box(34, 24, 5, 17),
    ...box(44, 9, 0, 11, 0, -12.5),
    ...box(44, 9, 0, 11, 0, 12.5),
    // Track links on each top run — three a side, coarse, exactly as the sheet draws them.
    ...[-14, 0, 14].flatMap((x) => [
      seg(x, -17, 11, x, -8, 11, NodeKind.Wheel),
      seg(x, 8, 11, x, 17, 11, NodeKind.Wheel),
    ]),
    // Engine deck at the rear, under a louvre.
    seg(-13, -8, 17, -13, 8, 17, NodeKind.Engine),
    seg(-16, -8, 17, -16, 8, 17, NodeKind.Engine),
  ],
};

/**
 * Fast wheeled buggy: a hull on four exposed tires.
 *
 * The tires are drawn as standing rectangles with a spoke bar, and they are drawn
 * *outboard of the hull* — an exposed wheel at each corner is the one thing that
 * says "this is the light fast one" before it has moved a pixel.
 */
const WHEELS: Chassis = {
  deck: 18,
  hull: [
    ...box(36, 22, 7, 18),
    // Sloped nose: the deck narrowing to a prow, which is what stops a plain box
    // reading as a crate when the buggy is coming at you.
    seg(18, -11, 18, 24, 0, 13),
    seg(18, 11, 18, 24, 0, 13),
    seg(18, -11, 7, 24, 0, 13),
    seg(18, 11, 7, 24, 0, 13),
    ...[13, -13].flatMap((x) => [-14, 14].flatMap((y) => wheel(x, y, 6.5, 6))).flat(),
    seg(-15, -8, 18, -15, 8, 18, NodeKind.Engine),
  ],
};

/**
 * Armoured walker: a wide body carried high on six short legs.
 *
 * The proportions are the ones the walker's art had to be regenerated to get right —
 * mass in the hull, legs short and thick underneath — and they are what make this the
 * one chassis whose *body is off the ground*. Seen from a hull two feet up, that gap
 * is the most legible difference between the three, at any range.
 */
const LEGS: Chassis = {
  deck: 27,
  hull: [
    ...box(34, 30, 14, 27),
    ...[16, 0, -16].flatMap((x) =>
      [-1, 1].flatMap((s) => [
        // Hip out to the knee, then the shin down to the foot: two segments, both
        // marked, because on a walker the joints are the drive.
        seg(x, s * 14, 16, x, s * 21, 9, NodeKind.Joint),
        seg(x, s * 21, 9, x, s * 19, 0, NodeKind.Joint),
      ]),
    ),
    seg(-17, -10, 27, -17, 10, 27, NodeKind.Engine),
    seg(-14, -10, 27, -14, 10, 27, NodeKind.Engine),
  ],
};

/** Every chassis, exhaustively — a new one in `types/src/enums.ts` fails to compile here. */
export const CHASSIS: Record<ChassisType, Chassis> = {
  [ChassisType.Tracks]: TRACKS,
  [ChassisType.Wheels]: WHEELS,
  [ChassisType.Legs]: LEGS,
};
