import { NodeKind, type Model, type Segment, type Vec3 } from './segment';

/**
 * The shapes a machine is built out of.
 *
 * Every one of these is a *budget* as much as a shape. A wireframe at the far end
 * of the monitor has room for a handful of lines, so a primitive that spends twelve
 * segments is spent only on the masses that *are* the machine — a hull, a track
 * band — and never on detail. Detail is what `detail()` and the `lod` tier are for.
 *
 * ## Faces, and why they are a list
 *
 * The solid primitives tag their edges with the faces they border (see
 * `Segment.faces`). Nothing is culled until a renderer asks for it, so this is
 * inert data that costs a frozen array per edge at module load and buys hidden-line
 * removal the day a caller wants it.
 */

/** Outward normals of the four sides of an axis-aligned box, in the order `plate` emits its edges. */
const SIDES: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, -1, 0],
];
const UP: Vec3 = [0, 0, 1];
const DOWN: Vec3 = [0, 0, -1];

export function seg(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  node?: NodeKind,
): Segment {
  return { x0, y0, z0, x1, y1, z1, node };
}

/**
 * A rectangle lying flat at height `z`, centred on the local origin unless offset.
 *
 * Untagged by default, and that is the safe default rather than an oversight: a
 * lone plate is a belt line or a bed plate, not the lid of a solid, and giving it
 * one normal would take it off the screen the moment the camera dropped below it.
 * `box` passes its own faces in.
 */
export function plate(
  len: number,
  wid: number,
  z: number,
  dx = 0,
  dy = 0,
  node?: NodeKind,
  cap?: Vec3,
): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  const corners: readonly (readonly [number, number])[] = [
    [dx + hx, dy - hy],
    [dx + hx, dy + hy],
    [dx - hx, dy + hy],
    [dx - hx, dy - hy],
  ];
  const out: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const edge = seg(a[0], a[1], z, b[0], b[1], z, node);
    // The edge borders the plate's own face and the side it caps; `cap` is the
    // former, `SIDES[i]` the latter.
    if (cap) edge.faces = [cap, SIDES[i]];
    out.push(edge);
  }
  return out;
}

/**
 * A rectangular solid: the plate at each end of its height plus the four uprights.
 *
 * Twelve segments, which is most of the budget of a whole model — so a box is spent
 * only on the masses that *are* the machine. The uprights are what make it a solid
 * rather than two floating outlines; without them a wireframe at range reads as
 * litter on the ground.
 */
export function box(
  len: number,
  wid: number,
  z0: number,
  z1: number,
  dx = 0,
  dy = 0,
  node?: NodeKind,
): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  const corners: readonly (readonly [number, number])[] = [
    [dx + hx, dy - hy],
    [dx + hx, dy + hy],
    [dx - hx, dy + hy],
    [dx - hx, dy - hy],
  ];
  const out = [...plate(len, wid, z0, dx, dy, node, DOWN), ...plate(len, wid, z1, dx, dy, node, UP)];
  for (let i = 0; i < 4; i++) {
    const [x, y] = corners[i];
    const upright = seg(x, y, z0, x, y, z1, node);
    // An upright is the meeting of two sides — the one this corner ends and the
    // one it begins — so it survives while either is facing the camera.
    upright.faces = [SIDES[(i + 3) % 4], SIDES[i]];
    out.push(upright);
  }
  return out;
}

/**
 * An open-ended tube: four longitudinal edges and a mouth at the front.
 *
 * A `box` would do it in twelve, but the back face is spent drawing a wall inside
 * the hull that nobody can see, and the *mouth* is the whole identity of a launch
 * tube. Eight segments, and the end that matters is the end that is drawn. The
 * mouth is left untagged for the same reason it is drawn at all: it is what says
 * this is a tube, and it must not vanish at any angle.
 */
export function tube(
  len: number,
  wid: number,
  z0: number,
  z1: number,
  dx: number,
  dy: number,
  node?: NodeKind,
): Segment[] {
  const hx = len / 2;
  const hy = wid / 2;
  const front = dx + hx;
  const back = dx - hx;
  const out: Segment[] = [];
  for (const [y, side] of [
    [dy - hy, SIDES[3]],
    [dy + hy, SIDES[1]],
  ] as const) {
    for (const [z, cap] of [
      [z0, DOWN],
      [z1, UP],
    ] as const) {
      const edge = seg(back, y, z, front, y, z, node);
      edge.faces = [side, cap];
      out.push(edge);
    }
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
export function ring(radius: number, z: number, sides: number, node?: NodeKind): Segment[] {
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

/**
 * A ring at each end of a height, plus an upright at every vertex: `box` with a
 * round cross-section.
 *
 * `3 × sides` segments, so it is affordable at six and extravagant at sixteen — and
 * six is usually right, because past that a wireframe cylinder stops reading as
 * rounder and starts reading as denser. The mast under a sensor head, a turret ring,
 * a canister: the shapes a rectangle makes look agricultural.
 */
export function prism(
  radius: number,
  z0: number,
  z1: number,
  sides: number,
  dx = 0,
  dy = 0,
  node?: NodeKind,
): Segment[] {
  const at = (i: number): readonly [number, number] => {
    const a = (i / sides) * Math.PI * 2;
    return [dx + Math.cos(a) * radius, dy + Math.sin(a) * radius];
  };
  /** Outward normal of the flat between vertex `i` and `i + 1`. */
  const faceOf = (i: number): Vec3 => {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a), 0];
  };
  const out: Segment[] = [];
  for (let i = 0; i < sides; i++) {
    const a = at(i);
    const b = at(i + 1);
    const face = faceOf(i);
    for (const [z, cap] of [
      [z0, DOWN],
      [z1, UP],
    ] as const) {
      const edge = seg(a[0], a[1], z, b[0], b[1], z, node);
      edge.faces = [face, cap];
      out.push(edge);
    }
    const upright = seg(a[0], a[1], z0, a[0], a[1], z1, node);
    upright.faces = [faceOf((i + sides - 1) % sides), face];
    out.push(upright);
  }
  return out;
}

/** The footprint of one end of a `frustum`. */
export interface Rect {
  len: number;
  wid: number;
}

/**
 * A box whose top is a different size from its bottom — a hull narrowing to a prow,
 * a turret with sloped cheeks, a plinth.
 *
 * Worth its own primitive rather than four hand-written lines because the slant is
 * where face normals stop being guessable: a sloped side faces partly upward, and
 * writing that out by hand at every call is how a hull ends up culled from above.
 */
export function frustum(
  bottom: Rect,
  top: Rect,
  z0: number,
  z1: number,
  dx = 0,
  dy = 0,
  node?: NodeKind,
): Segment[] {
  const corners = (r: Rect, z: number): readonly (readonly [number, number, number])[] => {
    const hx = r.len / 2;
    const hy = r.wid / 2;
    return [
      [dx + hx, dy - hy, z],
      [dx + hx, dy + hy, z],
      [dx - hx, dy + hy, z],
      [dx - hx, dy - hy, z],
    ];
  };
  const lower = corners(bottom, z0);
  const upper = corners(top, z1);
  /**
   * The slanted side's outward normal: perpendicular to the slope in the plane the
   * side leans in, which for side `i` is the axis `SIDES[i]` points along.
   */
  const faceOf = (i: number): Vec3 => {
    const half = (r: Rect) => (i % 2 === 0 ? r.len / 2 : r.wid / 2);
    const run = half(top) - half(bottom);
    const rise = z1 - z0;
    const s = SIDES[i];
    const scale = Math.hypot(rise, run) || 1;
    return [(s[0] * rise) / scale, (s[1] * rise) / scale, -run / scale];
  };
  const out: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const face = faceOf(i);
    const j = (i + 1) % 4;
    for (const [ends, cap] of [
      [lower, DOWN],
      [upper, UP],
    ] as const) {
      const a = ends[i];
      const b = ends[j];
      const edge = seg(a[0], a[1], a[2], b[0], b[1], b[2], node);
      edge.faces = [face, cap];
      out.push(edge);
    }
    const a = lower[i];
    const b = upper[i];
    const upright = seg(a[0], a[1], a[2], b[0], b[1], b[2], node);
    upright.faces = [faceOf((i + 3) % 4), face];
    out.push(upright);
  }
  return out;
}

/** The same ring stood on edge, facing sideways: a wheel, seen the way a wheel is seen. */
export function wheel(dx: number, dy: number, radius: number, sides: number): Segment[] {
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
export function shift(s: Segment, dx: number, dy: number): Segment {
  return { ...s, x0: s.x0 + dx, y0: s.y0 + dy, x1: s.x1 + dx, y1: s.y1 + dy };
}

/**
 * Stamp a detail tier onto a group of segments.
 *
 * The whole point of the tier is that it costs nothing to *add* detail that only
 * exists close up — panel lines, hatches, louvres, grab handles. Written as a
 * wrapper rather than a parameter on every primitive because detail comes in
 * clusters: one call around the greebles of a hull, not a trailing argument on
 * twenty of them.
 */
export function detail(tier: number, segments: Model): Segment[] {
  return segments.map((s) => ({ ...s, lod: tier }));
}
