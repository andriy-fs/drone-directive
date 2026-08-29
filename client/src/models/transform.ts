import type { Model, Segment, Vec3 } from './segment';

/**
 * Moving a part into place, once, at module load.
 *
 * **This is what makes a limb a part rather than a copy.** A walker has six legs;
 * written out by hand that is six sets of coordinates, and adjusting the knee means
 * getting the same edit right six times. Authored at the origin and placed with
 * `at()`, it is one shape and six placements — which is the difference between a
 * chassis whose proportions can be tuned and one whose proportions are whatever
 * they were first typed as.
 *
 * All of it runs when the module is imported, never per frame: a placed part is a
 * plain segment list again by the time anything draws it.
 */

/** Where a part goes: rotate (in this order), scale, then translate. */
export interface Placement {
  dx?: number;
  dy?: number;
  dz?: number;
  /** About `z`, the way a machine turns on the ground: positive swings forward toward the right. */
  yaw?: number;
  /**
   * About `y`: positive puts the nose **down**, so a barrel is elevated with a
   * negative one.
   *
   * That is the right-hand rule, which is what makes all three of these agree with
   * each other — and it happens to agree with the camera's `pitch` too, where
   * positive is also downward (`project.ts`). Two opposite senses of the word in
   * one folder is a trap; there is only the one.
   */
  pitch?: number;
  /** About `x`, the way a hull leans: positive drops the right side. */
  roll?: number;
  scale?: number;
}

/** Roll, then pitch, then yaw — the order a part is usually described in. */
function rotate(v: Vec3, p: Placement): Vec3 {
  const [rc, rs] = [Math.cos(p.roll ?? 0), Math.sin(p.roll ?? 0)];
  const [pc, ps] = [Math.cos(p.pitch ?? 0), Math.sin(p.pitch ?? 0)];
  const [yc, ys] = [Math.cos(p.yaw ?? 0), Math.sin(p.yaw ?? 0)];
  // Roll about x.
  const y1 = v[1] * rc - v[2] * rs;
  const z1 = v[1] * rs + v[2] * rc;
  // Pitch about y, right-handed: +x goes down and +z goes forward.
  const x2 = v[0] * pc + z1 * ps;
  const z2 = -v[0] * ps + z1 * pc;
  // Yaw about z.
  return [x2 * yc - y1 * ys, x2 * ys + y1 * yc, z2];
}

/**
 * A part, placed. Rotates the face normals with it — a lid that has been turned on
 * its side is no longer facing up, and a hidden-line pass that believed otherwise
 * would cull the parts of a machine that are pointing straight at the camera.
 */
export function at(model: Model, placement: Placement): Segment[] {
  const s = placement.scale ?? 1;
  const dx = placement.dx ?? 0;
  const dy = placement.dy ?? 0;
  const dz = placement.dz ?? 0;
  const point = (v: Vec3): Vec3 => {
    const r = rotate([v[0] * s, v[1] * s, v[2] * s], placement);
    return [r[0] + dx, r[1] + dy, r[2] + dz];
  };
  return model.map((seg) => {
    const a = point([seg.x0, seg.y0, seg.z0]);
    const b = point([seg.x1, seg.y1, seg.z1]);
    const moved: Segment = { ...seg, x0: a[0], y0: a[1], z0: a[2], x1: b[0], y1: b[1], z1: b[2] };
    // Scale and translation leave a normal alone; only the rotation touches it.
    if (seg.faces) moved.faces = seg.faces.map((f) => rotate(f, placement));
    return moved;
  });
}

/**
 * The same part on the other side, mirrored across the machine's centreline.
 *
 * Not `at({ scale: -1 })` in disguise: a mirror flips handedness, so the normals
 * have to be flipped with it or the far side of every machine culls itself. That
 * is the whole reason this is a function rather than a call to `at`.
 */
export function mirrorY(model: Model): Segment[] {
  return model.map((seg) => {
    const flipped: Segment = { ...seg, y0: -seg.y0, y1: -seg.y1 };
    if (seg.faces) flipped.faces = seg.faces.map(([nx, ny, nz]) => [nx, -ny, nz] as Vec3);
    return flipped;
  });
}
