import { ChassisType } from '@drone-directive/types/enums';
import { NodeKind, type Model } from './segment';
import { box, detail, seg, wheel } from './primitives';

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
 * ## Two tiers
 *
 * Tier 0 is the silhouette — the masses a machine is recognised by at the far end
 * of the monitor, and the only thing the hull view draws (`flatten` defaults to
 * `maxLod: 0`). Everything under `detail(1, …)` is the close-up read: running gear,
 * stowage, louvres, hooks. The preview panel asks for the lot; a firefight never
 * pays for it. Without that split a panel line costs the same at eight hundred
 * pixels as it does at eight.
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
    // The lid and the two bands that carry it: the silhouette, in three masses.
    ...box(34, 24, 5, 17),
    ...box(32, 9, 0, 11, 0, -12.5),
    ...box(32, 9, 0, 11, 0, 12.5),
    // A glacis proud of the nose. It stops *at* the deck rather than above it —
    // higher and the module bolts onto a plate instead of onto the hull.
    ...box(6, 16, 8, 17, 14, 0),
    // Track links on each top run — three a side, coarse, exactly as the sheet draws them.
    ...[-14, 0, 14].flatMap((x) => [
      seg(x, -17, 11, x, -8, 11, NodeKind.Wheel),
      seg(x, 8, 11, x, 17, 11, NodeKind.Wheel),
    ]),
    // Engine deck at the rear, under a louvre.
    seg(-13, -8, 17, -13, 8, 17, NodeKind.Engine),
    seg(-16, -8, 17, -16, 8, 17, NodeKind.Engine),

    ...detail(1, [
      ...[-1, 1].flatMap((s) => [
        // Idler and drive wheel stepped down off each end of a band. This is what
        // stops a track reading as a brick when it swings across the view, and it
        // is also eight boxes a side — close-up money, not silhouette money.
        ...box(4, 9, 1, 9, 18, s * 12.5),
        ...box(4, 9, 3, 7, 22, s * 12.5),
        ...box(4, 9, 1, 9, -18, s * 12.5),
        ...box(4, 9, 3, 7, -22, s * 12.5),
        // Skirt over the top run, and the stowage on the rear shelf.
        ...box(38, 1, 6, 15, 0, s * 17.5),
        ...box(8, 6, 11, 15, -14, s * 14),
        // Exhaust out of the rear plate; tow hook on the nose.
        seg(-17, s * 10, 14, -19, s * 10, 14, NodeKind.Engine),
        seg(17, s * 8, 8, 19, s * 8, 8),
      ]),
      // The links between the coarse three, and the rest of the louvre.
      ...[-16, -8, 8, 16].flatMap((x) => [
        seg(x, -17, 11, x, -8, 11, NodeKind.Wheel),
        seg(x, 8, 11, x, 17, 11, NodeKind.Wheel),
      ]),
      ...[-11.5, -14.5].map((x) => seg(x, -8, 17, x, 8, 17, NodeKind.Engine)),
    ]),
  ],
};

/**
 * Fast wheeled buggy: a hull on four exposed tires.
 *
 * The tires are drawn as standing rectangles with a spoke bar, and they are drawn
 * *outboard of the hull* — an exposed wheel at each corner is the one thing that
 * says "this is the light fast one" before it has moved a pixel.
 *
 * The deck is the roll cage, not the roof. A buggy that carries a gun carries it on
 * the bar, and putting the hardpoint at 18 instead would leave every module on this
 * chassis growing up through its own cage.
 */
const WHEELS: Chassis = {
  deck: 20,
  hull: [
    ...box(36, 22, 7, 18),
    // Sloped nose: the deck narrowing to a prow, which is what stops a plain box
    // reading as a crate when the buggy is coming at you.
    seg(18, -11, 18, 24, 0, 13),
    seg(18, 11, 18, 24, 0, 13),
    seg(18, -11, 7, 24, 0, 13),
    seg(18, 11, 7, 24, 0, 13),
    // Roll cage: two rails and three hoops, and the thing the module sits on.
    seg(-12, -9, 20, 10, -9, 20),
    seg(-12, 9, 20, 10, 9, 20),
    ...[-8, 0, 8].map((x) => seg(x, -9, 20, x, 9, 20)),
    ...[13, -13].flatMap((x) => [-14, 14].flatMap((y) => wheel(x, y, 6.5, 6))).flat(),
    seg(-15, -8, 18, -15, 8, 18, NodeKind.Engine),

    ...detail(1, [
      // Sponsons widening the hull, and the struts tying the bonnet to the cage.
      ...box(26, 4, 8, 14, 0, -12),
      ...box(26, 4, 8, 14, 0, 12),
      seg(12, -10, 18, 18, -10, 14),
      seg(12, 10, 18, 18, 10, 14),
      // Intake on the roof, kept under the cage line for the same reason as the deck.
      ...box(6, 8, 18, 20, -6, 0),
      // Nose ribbing, lamp blocks and the bull bar.
      seg(18, 0, 18, 24, 0, 13),
      ...box(3, 4, 15, 19, 17, -7),
      ...box(3, 4, 15, 19, 17, 7),
      seg(24, -5, 13, 24, 5, 13),
      seg(25, -6, 9, 25, 6, 9),
      seg(24, -5, 13, 25, -6, 9),
      seg(24, 5, 13, 25, 6, 9),
      // Arch over each wheel — `x` is front and rear here, `s` is left and right.
      ...[13, -13].flatMap((x) =>
        [-1, 1].flatMap((s) => [
          seg(x - 8, s * 14, 14, x + 8, s * 14, 14),
          seg(x - 8, s * 14, 14, x - 10, s * 11, 10),
          seg(x + 8, s * 14, 14, x + 10, s * 11, 10),
          // Double wishbone, then the hub block it carries. The damper is marked as
          // drive: it is the part that moves with the wheel.
          seg(x - 4, s * 11, 10, x, s * 14.5, 8),
          seg(x + 4, s * 11, 10, x, s * 14.5, 8),
          seg(x - 4, s * 11, 5, x, s * 14.5, 5),
          seg(x + 4, s * 11, 5, x, s * 14.5, 5),
          seg(x, s * 10, 14, x, s * 14, 6.5, NodeKind.Wheel),
          ...box(6, 2, 4, 9, x, s * 14),
          // Tread bar across the crown only: the underside of a tire is never seen.
          seg(x - 4, s * 15.5, 11.5, x + 4, s * 15.5, 11.5, NodeKind.Wheel),
        ]),
      ),
      // Rock sliders along the flanks.
      seg(7, -13.5, 7, -7, -13.5, 7),
      seg(7, 13.5, 7, -7, 13.5, 7),
      // The rest of the radiator louvre, the stacks, and the rear bumper.
      ...[-13, -17].map((x) => seg(x, -8, 18, x, 8, 18, NodeKind.Engine)),
      seg(-18, -6, 11, -21, -6, 11, NodeKind.Engine),
      seg(-18, 6, 11, -21, 6, 11, NodeKind.Engine),
      seg(-18, -10, 8, -18, 10, 8),
    ]),
  ],
};

/**
 * Armoured walker: a wide body carried high on six short legs.
 *
 * The proportions are the ones the walker's art had to be regenerated to get right —
 * mass in the hull, legs short and thick underneath — and they are what make this the
 * one chassis whose *body is off the ground*. Seen from a hull two feet up, that gap
 * is the most legible difference between the three, at any range.
 *
 * Every segment of a leg is marked, feet included. On a walker the running gear *is*
 * the joints, and leaving a foot unmarked would put untagged structure back down on
 * the ground — which is precisely the reading the gap under the body exists to deny.
 */
const LEGS: Chassis = {
  deck: 27,
  hull: [
    ...box(34, 30, 14, 27),
    // The belly hangs below the hull: mass between the legs, so the gap reads as
    // clearance rather than as a body that happens to be floating.
    ...box(26, 12, 10, 14, 0, 0),
    ...[16, 0, -16].flatMap((x) =>
      [-1, 1].flatMap((s) => [
        // Hip out to the knee, then the shin down to the foot: two segments, both
        // marked, because on a walker the joints are the drive.
        seg(x, s * 13, 16, x, s * 22, 10, NodeKind.Joint),
        seg(x, s * 22, 10, x, s * 19, 0, NodeKind.Joint),
      ]),
    ),
    seg(-17, -10, 27, -17, 10, 27, NodeKind.Engine),
    seg(-14, -10, 27, -14, 10, 27, NodeKind.Engine),

    ...detail(1, [
      // Sloped bow and the sensor blocks on it.
      ...box(6, 20, 18, 24, 17, 0),
      ...box(2, 6, 22, 24, 23, -5),
      ...box(2, 6, 22, 24, 23, 5),
      ...[16, 0, -16].flatMap((x) =>
        [-1, 1].flatMap((s) => [
          // The thigh, in full: two side beams over the spar and a tie under it.
          seg(x - 2.5, s * 13, 18, x - 2.5, s * 22, 11, NodeKind.Joint),
          seg(x + 2.5, s * 13, 18, x + 2.5, s * 22, 11, NodeKind.Joint),
          seg(x, s * 13, 13, x, s * 22, 8, NodeKind.Joint),
          // Knee: the cross axle and the shield in front of it.
          seg(x - 3, s * 22, 10, x + 3, s * 22, 10, NodeKind.Joint),
          seg(x, s * 23, 12, x, s * 23, 7, NodeKind.Joint),
          // Dampers either side of the shin.
          seg(x - 2, s * 21, 9, x - 2, s * 19, 1, NodeKind.Joint),
          seg(x + 2, s * 21, 9, x + 2, s * 19, 1, NodeKind.Joint),
          // Foot pad and its grouser cross.
          ...box(6, 6, 0, 2, x, s * 19, NodeKind.Joint),
          seg(x - 4, s * 19 - 2, 0, x + 4, s * 19 + 2, 0, NodeKind.Joint),
          seg(x - 4, s * 19 + 2, 0, x + 4, s * 19 - 2, 0, NodeKind.Joint),
        ]),
      ),
      // The rest of the back louvre, the stacks, and the mooring hooks.
      seg(-12, -10, 27, -12, 10, 27, NodeKind.Engine),
      seg(-17, -12, 20, -22, -12, 20, NodeKind.Engine),
      seg(-17, 12, 20, -22, 12, 20, NodeKind.Engine),
      seg(-17, -8, 16, -19, -8, 16),
      seg(-17, 8, 16, -19, 8, 16),
    ]),
  ],
};

/** Every chassis, exhaustively — a new one in `types/src/enums.ts` fails to compile here. */
export const CHASSIS: Record<ChassisType, Chassis> = {
  [ChassisType.Tracks]: TRACKS,
  [ChassisType.Wheels]: WHEELS,
  [ChassisType.Legs]: LEGS,
};
