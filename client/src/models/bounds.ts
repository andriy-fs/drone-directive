import type { Model } from './segment';
import { project, type Projection } from './project';
import type { UnitPose } from './flatten';

/** Extent of a model along one local axis — what a silhouette actually measures. */
export interface Span {
  min: number;
  max: number;
}

/** The box a model occupies in its own frame. Used to frame a preview, and to assert on shapes in tests. */
export interface ModelBounds {
  x: Span;
  y: Span;
  z: Span;
}

export function modelBounds(model: Model): ModelBounds {
  const span = (): Span => ({ min: Infinity, max: -Infinity });
  const out: ModelBounds = { x: span(), y: span(), z: span() };
  for (const s of model) {
    for (const [axis, a, b] of [
      ['x', s.x0, s.x1],
      ['y', s.y0, s.y1],
      ['z', s.z0, s.z1],
    ] as const) {
      const t = out[axis];
      t.min = Math.min(t.min, a, b);
      t.max = Math.max(t.max, a, b);
    }
  }
  return out;
}

/** Screen-space extent of a projected model — what the target brackets are hung on. */
export interface ScreenBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Where a model lands on screen, without drawing it.
 *
 * Projects the model's *points* rather than reusing whatever a draw pass left in
 * its scratch: at most one machine per frame is marked, so the cost is one model,
 * and a caller silently depending on draw order is the kind of coupling that breaks
 * the first time somebody reorders two loops.
 *
 * Points, not segments — an end that survived projection still tells you where the
 * machine is even when the other end of its line did not, which is what keeps a
 * bracket on a target the camera is half inside.
 */
export function screenBoundsOf(view: Projection, model: Model, pose: UnitPose): ScreenBounds | null {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of model) {
    for (const [lx, ly, lz] of [
      [m.x0, m.y0, m.z0],
      [m.x1, m.y1, m.z1],
    ]) {
      const p = project(view, pose.x + lx * c - ly * s, pose.y + lx * s + ly * c, pose.z + lz);
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}
