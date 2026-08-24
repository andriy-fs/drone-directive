import type { Cluster, Tile } from './clusters';

/**
 * The traced outline of a landform — the silhouette as an *object*, rather than as a
 * pile of tile edges every layer re-derives for itself.
 *
 * **Why this exists.** The wall, the bevel and the contact shadow all draw the same
 * boundary, and all three used to read it as `{tx, ty, side}`: axis-aligned segments
 * on the tile grid. That is what made the mountains look like two different games
 * bolted together. A face built from south-facing tile runs is a row of horizontal
 * dashes along a staircase, each with its own phase of the art; an edge shaded by
 * `side` flips from lit to dark in one step at a tile corner. Neither can follow a
 * shape, because neither has one.
 *
 * A contour has one. It is a closed, ordered, **resampled** polyline with an outward
 * **normal** and an **arc length** at every point, so:
 *
 * - the rock face extrudes off it and therefore repeats it by construction;
 * - `u` can be arc length, which runs continuously around a cluster instead of
 *   restarting at every step of its staircase;
 * - lighting becomes a continuous function of the normal, so an edge turning from
 *   north to east loses its highlight gradually — the bevel, not the flat cut.
 *
 * Pure: no Pixi, no config, and the warp is **injected** as `corner`, exactly as
 * `debris.ts` injects it — so a test can trace on the bare grid.
 */

/** One sample on a traced outline: where it is, which way is out, how far along it sits. */
export interface ContourPoint {
  x: number;
  y: number;
  /** Outward unit normal — away from the rock. */
  nx: number;
  ny: number;
  /** Distance along the contour from its first point, in px. */
  s: number;
}

export interface Contour {
  /** Ordered and closed: the first point is **not** repeated at the end. Wrap with `% length`. */
  points: ContourPoint[];
  /** Perimeter in px. */
  length: number;
  /** True for a loop around a hole *inside* a cluster; its normals point into the hole. */
  hole: boolean;
  /**
   * The loop's northern-then-western-most grid corner — a stable identity for it.
   *
   * Everything seeded per contour (the art's phase, its variant) hashes this rather
   * than an array index: a change to `findClusters`' visit order would otherwise
   * repaint the map differently on two peers.
   */
  key: { cx: number; cy: number };
}

export interface ContourOptions {
  /** Where a grid corner is drawn — `warpedCorner` in the renderer, identity in tests. */
  corner: (cx: number, cy: number) => { x: number; y: number };
  /** Target distance between samples, in px. */
  spacing: number;
}

interface Corner {
  cx: number;
  cy: number;
}

interface DirectedEdge {
  from: Corner;
  to: Corner;
  /** Unit step of travel on the grid. */
  dx: number;
  dy: number;
  used: boolean;
}

const key = (cx: number, cy: number): string => `${cx},${cy}`;

/**
 * The four sides of a tile as directed grid edges, oriented so the **rock stays on the
 * right** of travel (y down the screen).
 *
 * One orientation for everything is what makes holes free: the tile north of an
 * enclosed gap contributes its `s` edge, whose outward normal `(0, +1)` points down
 * into the gap — away from rock, which is the only thing "outward" has ever meant
 * here. No per-loop sign correction anywhere.
 */
const SIDES: readonly { ox: number; oy: number; from: Corner; to: Corner }[] = [
  { ox: 0, oy: -1, from: { cx: 0, cy: 0 }, to: { cx: 1, cy: 0 } }, // n, travelling east
  { ox: 1, oy: 0, from: { cx: 1, cy: 0 }, to: { cx: 1, cy: 1 } }, // e, travelling south
  { ox: 0, oy: 1, from: { cx: 1, cy: 1 }, to: { cx: 0, cy: 1 } }, // s, travelling west
  { ox: -1, oy: 0, from: { cx: 0, cy: 1 }, to: { cx: 0, cy: 0 } }, // w, travelling north
];

/**
 * Every boundary of a cluster, as closed loops of grid corners.
 *
 * **Membership, not kind.** Deliberately not built on `boundaryEdges`: that tests by
 * `TerrainKind`, so two same-kind clusters touching at a corner would hand back one
 * tangled edge set. A cluster's own tile list cannot do that.
 *
 * **The saddle rule.** Where a cluster pinches at a diagonal — two tiles meeting at
 * one corner — that corner has two outgoing edges and the walk has to choose. It
 * takes the sharpest left turn (`cross(dirIn, dirOut) === +1`, the sense a convex
 * tile corner turns), which yields **two loops touching at a point** rather than one
 * self-crossing figure of eight. That is the pairing a 4-connected foreground against
 * an 8-connected background demands, and 4-connectivity is exactly what `findClusters`
 * already commits to.
 *
 * Exported for the tests: this rule is the one thing here worth pinning.
 */
export function traceLoops(cluster: Cluster): Corner[][] {
  const inside = new Set<string>();
  for (const t of cluster.tiles) inside.add(key(t.tx, t.ty));

  const edges: DirectedEdge[] = [];
  const byStart = new Map<string, DirectedEdge[]>();
  const add = (t: Tile, side: (typeof SIDES)[number]): void => {
    const edge: DirectedEdge = {
      from: { cx: t.tx + side.from.cx, cy: t.ty + side.from.cy },
      to: { cx: t.tx + side.to.cx, cy: t.ty + side.to.cy },
      dx: side.to.cx - side.from.cx,
      dy: side.to.cy - side.from.cy,
      used: false,
    };
    edges.push(edge);
    const k = key(edge.from.cx, edge.from.cy);
    const list = byStart.get(k);
    if (list) list.push(edge);
    else byStart.set(k, [edge]);
  };

  // Tile order, so the seeds — and therefore the loop order before sorting — are
  // whatever `findClusters` produced, which is deterministic.
  for (const t of cluster.tiles) {
    for (const side of SIDES) {
      if (!inside.has(key(t.tx + side.ox, t.ty + side.oy))) add(t, side);
    }
  }

  const loops: Corner[][] = [];
  for (const seed of edges) {
    if (seed.used) continue;
    const loop: Corner[] = [];
    let cur: DirectedEdge | null = seed;
    while (cur) {
      cur.used = true;
      loop.push(cur.from);
      const candidates: DirectedEdge[] = (byStart.get(key(cur.to.cx, cur.to.cy)) ?? []).filter((e) => !e.used);
      if (!candidates.length) break; // the loop closed — or, defensively, a torn edge set
      let best: DirectedEdge = candidates[0];
      // cross(in, out): +1 turns the way a convex corner does, -1 cuts across the pinch.
      let bestTurn = cur.dx * best.dy - cur.dy * best.dx;
      for (const c of candidates.slice(1)) {
        const turn = cur.dx * c.dy - cur.dy * c.dx;
        if (turn > bestTurn) {
          best = c;
          bestTurn = turn;
        }
      }
      cur = best;
    }
    if (loop.length >= 4) loops.push(loop);
  }

  return loops;
}

/** Twice the signed area of a grid loop. Positive for an outer loop, negative for a hole. */
function signedArea2(loop: Corner[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.cx * b.cy - b.cx * a.cy;
  }
  return sum;
}

function loopKey(loop: Corner[]): Corner {
  let best = loop[0];
  for (const c of loop) {
    if (c.cy < best.cy || (c.cy === best.cy && c.cx < best.cx)) best = c;
  }
  return best;
}

/**
 * The cluster's outline, warped, resampled at `spacing`, with normals and arc length.
 *
 * Resampling is what lets a consumer treat the outline as a curve: a wall vertex every
 * `spacing` px however the corners fall, and an arc length that means the same thing
 * on a straight edge and around a bend.
 *
 * Normals come from a **central difference** — the tangent between the neighbouring
 * samples, not the segment the sample sits on. At a warped right angle that gives the
 * 45° normal a bevel wants, and it costs nothing anywhere else. Deliberately not
 * miter-scaled: a plain unit normal makes an offset band *shrink* into a concave
 * corner instead of spiking out of it, which is the failure direction that looks like
 * shadow rather than like a bug.
 */
export function clusterContours(cluster: Cluster, o: ContourOptions): Contour[] {
  const contours: Contour[] = [];

  for (const loop of traceLoops(cluster)) {
    const hull = loop.map((c) => o.corner(c.cx, c.cy));
    const lengths: number[] = [];
    let perimeter = 0;
    for (let i = 0; i < hull.length; i++) {
      const a = hull[i];
      const b = hull[(i + 1) % hull.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lengths.push(len);
      perimeter += len;
    }
    if (perimeter <= 0) continue;

    const steps = Math.max(3, Math.round(perimeter / o.spacing));
    const step = perimeter / steps;
    const points: ContourPoint[] = [];

    // One pass along the segment list rather than a search per sample.
    let seg = 0;
    let acc = 0;
    for (let i = 0; i < steps; i++) {
      const target = i * step;
      while (seg < lengths.length - 1 && acc + lengths[seg] <= target) {
        acc += lengths[seg];
        seg++;
      }
      const a = hull[seg];
      const b = hull[(seg + 1) % hull.length];
      const t = lengths[seg] > 0 ? (target - acc) / lengths[seg] : 0;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: 0, ny: 0, s: target });
    }

    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length];
      const next = points[(i + 1) % points.length];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      let len = Math.hypot(tx, ty);
      if (len < 1e-6) {
        // A 180° spur — the two neighbours landed on top of each other at a pinch.
        // Fall back to the outgoing segment, which always has a direction.
        tx = next.x - points[i].x;
        ty = next.y - points[i].y;
        len = Math.hypot(tx, ty);
      }
      if (len < 1e-6) {
        points[i].nx = 0;
        points[i].ny = 1;
        continue;
      }
      points[i].nx = ty / len;
      points[i].ny = -tx / len;
    }

    const k = loopKey(loop);
    contours.push({ points, length: perimeter, hole: signedArea2(loop) < 0, key: { cx: k.cx, cy: k.cy } });
  }

  // Sorted by identity, not by discovery order, so downstream hashing is peer-identical.
  contours.sort((a, b) => a.key.cy - b.key.cy || a.key.cx - b.key.cx);
  return contours;
}

/** A point pushed `d` px along its outward normal. Negative `d` goes into the rock. */
export function offsetPoint(p: ContourPoint, d: number): { x: number; y: number } {
  return { x: p.x + p.nx * d, y: p.y + p.ny * d };
}

/** GLSL's `smoothstep`, in TypeScript — the weights on this layer are all shaped with it. */
export function smoothstep(lo: number, hi: number, x: number): number {
  if (hi === lo) return x < lo ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
