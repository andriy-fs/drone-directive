import type { Model, NodeKind } from './segment';
import { project, type Projection } from './project';

/**
 * A model, rotated onto its machine's heading and put through the matrix: the one
 * step both renderers share.
 *
 * The hull view strokes the result into a Pixi `Graphics`; the interface writes it
 * out as SVG `<line>` elements. Those are two adapters over the same twenty lines
 * of trigonometry, and this is those twenty lines — which is the whole reason the
 * models could leave `pixi/` at all.
 *
 * ## Writes into the caller's buffer
 *
 * `flatten` fills an array it is given and returns how much of it is live. That is
 * not premature: the hull view rebuilds every machine in a 66° sector of the map
 * sixty times a second, and returning a fresh array per machine per frame is a
 * garbage collector running during a firefight. A preview panel hands over an array
 * it rebuilds when its props change and never thinks about it again.
 *
 * The buffer stays **index-aligned with the model** — a segment that was clipped or
 * culled is written with `ok: false` rather than skipped — so a caller can make
 * several passes over the same projection (structure, then the hot nodes over it)
 * without projecting anything twice.
 */

/** Position, altitude and facing of one machine, in world coordinates. */
export interface UnitPose {
  x: number;
  y: number;
  /** Ground height under it. */
  z: number;
  heading: number;
}

/** One segment of a model after projection, in CSS pixels from the canvas's top-left. */
export interface Flat {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Mean distance of the two ends in front of the camera, in world px — what a depth fade reads. */
  depth: number;
  /** Carried through so a caller can make a pass per node kind without re-reading the model. */
  node?: NodeKind;
  /** False when this segment was clipped, culled, or below the detail tier asked for. */
  ok: boolean;
}

export interface FlattenOptions {
  /**
   * The finest detail tier to draw. Segments above it are skipped — see
   * `Segment.lod`. Defaults to 0: the silhouette, and nothing that only exists
   * close up.
   */
  maxLod?: number;
  /**
   * Drop edges whose every bordering face is turned away from the camera.
   *
   * Off by default, and that is the honest default rather than a timid one: a model
   * whose primitives carry no face normals would be drawn identically either way,
   * so a caller switching this on is stating that its models have been tagged.
   */
  cull?: boolean;
}

/** Grow the buffer to whatever the largest model drawn through it needs, and never reallocate again. */
function slot(out: Flat[], i: number): Flat {
  const existing = out[i];
  if (existing) return existing;
  const fresh: Flat = { ax: 0, ay: 0, bx: 0, by: 0, depth: 0, ok: false };
  out[i] = fresh;
  return fresh;
}

/**
 * Project one machine's model into `out`. Returns the number of entries written,
 * which is always the model's length.
 */
export function flatten(
  out: Flat[],
  model: Model,
  pose: UnitPose,
  view: Projection,
  options?: FlattenOptions,
): number {
  const maxLod = options?.maxLod ?? 0;
  const cull = options?.cull ?? false;
  // Forward is (cos h, sin h); right is that turned 90° clockwise on the map,
  // which is (−sin h, cos h) — see `project.ts` on why clockwise is right here.
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);

  for (let i = 0; i < model.length; i++) {
    const m = model[i];
    const p = slot(out, i);
    p.node = m.node;

    if ((m.lod ?? 0) > maxLod) {
      p.ok = false;
      continue;
    }

    const ax = pose.x + m.x0 * c - m.y0 * s;
    const ay = pose.y + m.x0 * s + m.y0 * c;
    const az = pose.z + m.z0;
    const bx = pose.x + m.x1 * c - m.y1 * s;
    const by = pose.y + m.x1 * s + m.y1 * c;
    const bz = pose.z + m.z1;

    if (cull && m.faces && hidden(m.faces, c, s, view, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)) {
      p.ok = false;
      continue;
    }

    const a = project(view, ax, ay, az);
    const b = project(view, bx, by, bz);
    // Both ends or neither: `project` clips rather than intersects, so half a
    // projected segment is a line to a point the model never had.
    p.ok = a !== null && b !== null;
    if (a && b) {
      p.ax = a.x;
      p.ay = a.y;
      p.bx = b.x;
      p.by = b.y;
      p.depth = (a.depth + b.depth) / 2;
    }
  }
  return model.length;
}

/**
 * Whether every face this edge borders is turned away from the eye.
 *
 * "Every", not "any" — see `Segment.faces`. The test is the sign of the dot product
 * between the face's normal, rotated onto the machine's heading, and the direction
 * from the edge to the camera. Exact for a convex solid, which is what all of these
 * primitives are; a concave machine would need a depth buffer, and this view has
 * chosen not to have one.
 */
function hidden(
  faces: readonly (readonly [number, number, number])[],
  c: number,
  s: number,
  view: Projection,
  mx: number,
  my: number,
  mz: number,
): boolean {
  const vx = view.eye.x - mx;
  const vy = view.eye.y - my;
  const vz = view.eye.z - mz;
  for (const f of faces) {
    const nx = f[0] * c - f[1] * s;
    const ny = f[0] * s + f[1] * c;
    if (nx * vx + ny * vy + f[2] * vz > 0) return false;
  }
  return true;
}
