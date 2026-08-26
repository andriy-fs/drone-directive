import { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * What every machine looks like on the monitor: line segments in the machine's own
 * coordinates, a few dozen each, with the parts that get hot marked as such.
 *
 * **Data in code, and deliberately no art pipeline.** A wireframe is a list of
 * vertices; there is nothing here for `encode-sprites.mjs` to encode, no master to
 * keep, and no brief to write. The cost is paid elsewhere and is worth stating
 * plainly: **a new unit is now two jobs** — a sprite and a model — and a forgotten
 * model makes that unit *invisible* to anyone in a hull, which no test would catch.
 * The insurance is that `CHASSIS` and `WEAPONS` below are exhaustive `Record`s over
 * `types/src/enums.ts`, so a new key there fails the build instead of the picture.
 *
 * ## The local frame
 *
 * `x` runs **forward** along the machine's heading, `y` to its **right**, `z` up
 * from the ground it stands on. That is not the world frame renamed: world `y` runs
 * south, and a machine's right is south only when it happens to face east.
 * `units.ts` owns the rotation.
 *
 * ## What these are drawn against
 *
 * The sprites, not the collision radius. A robot is 46 px of art on the field
 * (`config/sprites.ts`), 52 for the walker, and a weapon module is 30 px on every
 * chassis — so a player who has learned to tell a walker from a buggy from above
 * reads the same proportions from inside one. The briefs in
 * `.docs/internal/sprites/robots.md` and `weapons.md` are what each model quotes:
 * the tank is a lid on two bands, the buggy is a hull on four exposed tires, the
 * walker is a wide body carried high on six short legs, the cannon is one long
 * barrel, the launcher is two fat tubes, and so on. Dimensions differ by a few px
 * where a wireframe needs the room; identities do not differ at all.
 *
 * ## Node marks
 *
 * A marked segment is drawn twice — once as structure, once more in the heat colour
 * at whatever `units.ts` says that node is running at. **Nothing new is needed from
 * the simulation for that**: `weapon.cooldownLeft / weapon.cooldown` already means
 * "just fired", and `movement.velX/velY` against `movement.speed` already means
 * "driving hard". The marks are only the map from those two numbers to the parts of
 * the machine they belong to.
 */

/** The four kinds of part that run hot. Everything else is structure. */
export const NodeKind = {
  /** Anything turning against the ground — a track link, a road wheel, a tire. */
  Wheel: 'wheel',
  /** An articulated joint: a walker's hip and knee. */
  Joint: 'joint',
  /** The powerplant, wherever the chassis puts it. */
  Engine: 'engine',
  /** Whatever the weapon sends its round, beam or swarm out of. */
  Barrel: 'barrel',
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

/** One line of a model, both ends in local coordinates. `node` marks it as a part that heats. */
export interface Segment {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  node?: NodeKind;
}

/** A machine's outline: segments in local coordinates, drawn at its position and heading. */
export type Model = readonly Segment[];

function seg(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, node?: NodeKind): Segment {
  return { x0, y0, z0, x1, y1, z1, node };
}

/** A rectangle lying flat at height `z`, centred on the local origin unless offset. */
function plate(len: number, wid: number, z: number, dx = 0, dy = 0, node?: NodeKind): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  return [
    seg(dx + hx, dy - hy, z, dx + hx, dy + hy, z, node),
    seg(dx + hx, dy + hy, z, dx - hx, dy + hy, z, node),
    seg(dx - hx, dy + hy, z, dx - hx, dy - hy, z, node),
    seg(dx - hx, dy - hy, z, dx + hx, dy - hy, z, node),
  ];
}

/**
 * A rectangular solid: the plate at each end of its height plus the four uprights.
 *
 * Twelve segments, which is most of the budget of a whole model — so a box is spent
 * only on the masses that *are* the machine (a hull, a track band), never on detail.
 * The uprights are what make it a solid rather than two floating outlines; without
 * them a wireframe at range reads as litter on the ground.
 */
function box(len: number, wid: number, z0: number, z1: number, dx = 0, dy = 0, node?: NodeKind): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  const corners: readonly (readonly [number, number])[] = [
    [dx + hx, dy - hy],
    [dx + hx, dy + hy],
    [dx - hx, dy + hy],
    [dx - hx, dy - hy],
  ];
  const out = [...plate(len, wid, z0, dx, dy, node), ...plate(len, wid, z1, dx, dy, node)];
  for (const [x, y] of corners) out.push(seg(x, y, z0, x, y, z1, node));
  return out;
}

/**
 * An open-ended tube: four longitudinal edges and a mouth at the front.
 *
 * A `box` would do it in twelve, but the back face is spent drawing a wall inside
 * the hull that nobody can see, and the *mouth* is the whole identity of a launch
 * tube. Eight segments, and the end that matters is the end that is drawn.
 */
function tube(len: number, wid: number, z0: number, z1: number, dx: number, dy: number, node?: NodeKind): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  const front = dx + hx;
  const back = dx - hx;
  const out: Segment[] = [];
  for (const y of [dy - hy, dy + hy]) {
    for (const z of [z0, z1]) out.push(seg(back, y, z, front, y, z, node));
  }
  out.push(
    seg(front, dy - hy, z0, front, dy + hy, z0, node),
    seg(front, dy + hy, z0, front, dy + hy, z1, node),
    seg(front, dy + hy, z1, front, dy - hy, z1, node),
    seg(front, dy - hy, z1, front, dy - hy, z0, node),
  );
  return out;
}

/** A flat ring of `sides` segments at height `z` — the cheapest thing that reads as round. */
function ring(radius: number, z: number, sides: number, node?: NodeKind): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 1) / sides) * Math.PI * 2;
    out.push(
      seg(Math.cos(a) * radius, Math.sin(a) * radius, z, Math.cos(b) * radius, Math.sin(b) * radius, z, node),
    );
  }
  return out;
}

/** The same ring stood on edge, facing sideways: a wheel, seen the way a wheel is seen. */
function wheel(dx: number, dy: number, radius: number, sides: number): Segment[] {
  // Phased so a vertex lands at the bottom of the rim: a polygon started at zero
  // has its lowest corner short of the ground, and a wheel visibly hovering is the
  // one flaw a wireframe cannot hide.
  const at = (i: number): { x: number; z: number } => {
    const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    return { x: dx + Math.cos(a) * radius, z: radius + Math.sin(a) * radius };
  };
  const out: Segment[] = [];
  for (let i = 0; i < sides; i++) {
    const a = at(i);
    const b = at(i + 1);
    out.push(seg(a.x, dy, a.z, b.x, dy, b.z, NodeKind.Wheel));
  }
  // One spoke across it. A rim alone turns invisibly; the spoke is what a turning
  // wheel is read by, here exactly as in the sprite sheet's light marker.
  const s0 = at(1);
  const s1 = at(1 + sides / 2);
  out.push(seg(s0.x, dy, s0.z, s1.x, dy, s1.z, NodeKind.Wheel));
  return out;
}

/** A segment moved in the ground plane — for parts laid out in a repeating pattern. */
function shift(s: Segment, dx: number, dy: number): Segment {
  return { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
}

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

/**
 * Every weapon module, exhaustively, authored flat at `z = 0` and lifted onto a
 * chassis's deck by `robotModel`.
 *
 * Each one is the *dominant form* its sprite brief names and nothing else: the
 * cannon is one long barrel, the launcher is two fat tubes with open mouths, the
 * jammer is an X of four aerials, the emitter is a ring, the carrier is a
 * perforated canister. At 30 px the art has room for three or four shapes; a
 * wireframe at range has room for fewer, so each model keeps only the first.
 */
export const WEAPONS: Record<WeaponType, Model> = {
  // An empty hardpoint is a real state, not a missing entry.
  [WeaponType.None]: [],

  /** One thick barrel down the long axis, on a breech block. The baseline gun. */
  [WeaponType.Cannon]: [...plate(14, 14, 0), ...box(22, 5, 3, 8, 11, 0, NodeKind.Barrel)],

  /** Two fat tubes with dark mouths — heavier than the cannon, and it has to look it. */
  [WeaponType.Missiles]: [
    ...plate(14, 16, 0),
    ...tube(20, 6, 2, 9, 8, -5, NodeKind.Barrel),
    ...tube(20, 6, 2, 9, 8, 5, NodeKind.Barrel),
  ],

  /** The payload disc under its hazard cross. No barrel: this one *is* the round. */
  [WeaponType.Bomb]: [
    ...ring(13, 4, 8, NodeKind.Barrel),
    seg(-9, -9, 4, 9, 9, 4, NodeKind.Barrel),
    seg(-9, 9, 4, 9, -9, 4, NodeKind.Barrel),
    seg(0, 0, 4, 0, 0, 10, NodeKind.Barrel),
  ],

  /** A dish on a mast, tilted back. Unmarked: a sensor has nothing that runs hot. */
  [WeaponType.Radar]: [
    seg(0, 0, 0, 0, 0, 7),
    seg(-6, -12, 8, -6, 12, 8),
    seg(-6, 12, 8, 8, 12, 16),
    seg(8, 12, 16, 8, -12, 16),
    seg(8, -12, 16, -6, -12, 8),
    seg(-6, 0, 8, 8, 0, 16),
  ],

  /** Four thick aerials out to the module's edge — a cross, where `dew` is a ring. */
  [WeaponType.Ew]: [
    ...plate(8, 8, 0),
    seg(0, 0, 2, 13, 13, 13),
    seg(0, 0, 2, 13, -13, 13),
    seg(0, 0, 2, -13, 13, 13),
    seg(0, 0, 2, -13, -13, 13),
    seg(0, 0, 2, 0, 0, 15),
  ],

  /** The emitter coil: a raised ring on four struts, the brightest module in the set. */
  [WeaponType.Dew]: [
    ...plate(10, 10, 0),
    ...ring(11, 11, 8, NodeKind.Barrel),
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      return seg(0, 0, 1, Math.cos(a) * 11, Math.sin(a) * 11, 11);
    }),
    seg(0, 0, 4, 0, 0, 11, NodeKind.Barrel),
  ],

  /**
   * A sealed canister perforated by five launch cells, opening upward — the salvo
   * size is legible from the model, exactly as it is from the sprite. Not
   * directional: the drones leave straight up.
   */
  [WeaponType.Fpv]: [
    ...box(20, 18, 0, 11),
    ...[-7, -3.5, 0, 3.5, 7].map((y) => seg(-7, y, 11, 7, y, 11, NodeKind.Barrel)),
  ],
};

/** Chassis + module, composed once at module load — 3 × 8 tables of a few dozen segments. */
function compose(chassis: Chassis, weapon: Model): Model {
  return [...chassis.hull, ...weapon.map((s) => ({ ...s, z0: s.z0 + chassis.deck, z1: s.z1 + chassis.deck }))];
}

/**
 * Every robot the game can build, as a finished outline.
 *
 * Built up front rather than per frame: there are twenty-four of them, each a few
 * dozen segments, and the alternative is composing the same arrays again for every
 * machine in the frustum sixty times a second.
 */
export const ROBOT_MODELS: Record<ChassisType, Record<WeaponType, Model>> = Object.fromEntries(
  Object.entries(CHASSIS).map(([chassis, spec]) => [
    chassis,
    Object.fromEntries(Object.entries(WEAPONS).map(([weapon, model]) => [weapon, compose(spec, model)])),
  ]),
) as Record<ChassisType, Record<WeaponType, Model>>;

/**
 * A base's building, without its launcher.
 *
 * Split in two because the two point different ways: `BaseView` draws the body
 * square to the world and rotates only the turret, which is what `base.heading`
 * actually holds (`taskSystem`'s turret pass writes it). Drawing them as one model
 * would swing the whole building round every time the battery tracked a target.
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
