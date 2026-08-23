import { Geometry } from 'pixi.js';
import type { Contour, ContourPoint } from './contours';
import { offsetPoint, smoothstep } from './contours';
import { hashRange } from './hash';

/**
 * Geometry for the mountains' rock faces: a strip standing on the cluster's traced
 * **contour**, inside the footprint, plus the debris that spills out of its base.
 *
 * **Why a contour and not the tile runs it replaces.** The face used to be built from
 * maximal straight runs of south-facing tile edges. On a staircase — which is what a
 * warped blob's boundary mostly is — that is a row of short horizontal walls at
 * different heights, each drawing its own slice of the art, with nothing at all on the
 * steps between them. The top of the mountain had an organic outline and the bottom
 * had a ruler, and they read as two different games. Standing the strip on the contour
 * makes the wall repeat the silhouette by construction, and makes `u` an arc length
 * that runs continuously around the whole cluster.
 *
 * **Only the part turned away from the light gets a wall.** With light from the
 * north-west, `n`/`w` are the lit top of the rock and belong to the bevel; the wall is
 * what a south-facing stretch shows. `facing` is now a continuous weight rather than a
 * side test, so a bend from south to east loses its wall gradually instead of ending
 * on a vertical cut.
 *
 * **The wall never leaves the footprint.** It extrudes straight **up the screen**, and
 * `facing` is only non-zero where the outward normal is south-ish — so up from the
 * boundary is into the rock. Height stays capped at one tile by the caller, because
 * about half of all generated mountain clusters are one tile thick. Only debris is
 * allowed out: the apron and the scree below it.
 */
export interface CliffOptions {
  /** Nominal face height in px at full facing. Must be ≤ `tilePx`. */
  height: number;
  /** How much wall one pass of the art covers, in px. Also the range a contour's phase is drawn from. */
  repeatPx: number;
  /** Outward-normal `ny` at which a wall starts, and at which it reaches full height. */
  facingLo: number;
  facingHi: number;
  /**
   * How far the rubble spills **past** the footprint, onto open ground, in px. 0 for
   * no apron.
   *
   * This is the one part of the wall itself allowed outside the blocked cells. Only
   * debris goes out there — the precedent is `ejectaLayer`, which has drawn a crater's
   * halo on passable ground all along.
   */
  apron: number;
  /**
   * Where in the art the apron starts sampling, 0..1 down the wall. The apron is the
   * image's own rubble band drawn a second time, squashed, below the footprint — so
   * this wants to sit just above where the loose stone begins.
   */
  apronV0: number;
  /** Loose stones scattered on the ground below the apron. `perPx: 0` for none. */
  scree: { perPx: number; minSize: number; maxSize: number; spread: number };
}

/** Fractions of the sheet's height the scree quads sample — the loose-stone band at its foot. */
const SCREE_V = { top: 0.82, bottom: 0.99 } as const;
/** Alpha a stone starts at, before it is faded by how far from the wall it landed. */
const SCREE_ALPHA = { min: 0.5, max: 0.85 } as const;
/** Below this facing a stretch of contour is bare ground as far as the debris is concerned. */
const SCREE_FACING = 0.3;

/** One sample of a wall arc: the contour point, plus its arc length unwrapped past the loop's end. */
interface ArcSample {
  p: ContourPoint;
  s: number;
  facing: number;
}

/**
 * Builds one `Geometry` for every contour given, or `null` if there is nothing to draw.
 *
 * Attributes are `aPosition`, `aU` (**arc length** along the contour, offset by a
 * per-contour phase), `aV` (0 at the top of the sheet, 1 at its base), `aAlpha` and
 * `aLip` (1 on the vertices at the top of the wall, 0 everywhere else).
 *
 * **`v` is anchored at the base, not at the top.** The art maps its full height onto
 * the wall exactly once, so a height that varies from vertex to vertex stretches the
 * strata by a different amount every few px — which is why the old procedural
 * scalloping had to be switched off the moment the art landed. Anchoring `v` at the
 * base means a full-height wall shows the whole sheet as before, while a stretch that
 * tapers off shows only the *bottom* of it: the rubble skirt, fading into its own
 * alpha. The flank crumbles into debris instead of ending on a squeezed slice of rock.
 *
 * **The phase is why a long wall does not read as a repeat**, and the arc length is
 * why it no longer restarts at every step. `aU` used to be a world x with a phase per
 * run, so the art began again at each staircase step and every wall on the map shared
 * one lattice. One phase per contour, plus a coordinate that runs around the loop,
 * makes a staircase a single wall stepping down.
 *
 * `aAlpha` fades the debris and the flanks: `facing` across the wall, 1 → 0 down the
 * apron, and per-stone on the scree. Carrying it per vertex keeps wall, apron and
 * stones in **one mesh** — the alternative is a draw call each to fade something the
 * rasteriser interpolates for free.
 */
export function cliffGeometry(contours: readonly Contour[], o: CliffOptions): Geometry | null {
  const positions: number[] = [];
  const us: number[] = [];
  const vs: number[] = [];
  const alphas: number[] = [];
  const lips: number[] = [];
  const indices: number[] = [];
  const apron = o.apron > 0;
  // Four vertices per sample with an apron, two without — the stride the index maths
  // below steps by.
  const stride = apron ? 4 : 2;

  const vertex = (x: number, y: number, u: number, v: number, a: number, lip: number): void => {
    positions.push(x, y);
    us.push(u);
    vs.push(v);
    alphas.push(a);
    lips.push(lip);
  };

  for (const contour of contours) {
    const phase = hashRange(contour.key.cx, contour.key.cy, 0x77, 0, o.repeatPx);

    for (const arc of wallArcs(contour, o)) {
      for (let i = 0; i < arc.length; i++) {
        const { p, s, facing } = arc[i];
        const h = o.height * facing;
        const u = s + phase;
        // Base-anchored: a short wall shows the foot of the sheet, never a squeeze of it.
        const v0 = 1 - h / o.height;

        vertex(p.x, p.y - h, u, v0, facing, 1);
        vertex(p.x, p.y, u, 1, facing, 0);
        if (apron) {
          const foot = offsetPoint(p, o.apron * facing);
          vertex(p.x, p.y, u, o.apronV0, facing, 0);
          vertex(foot.x, foot.y, u, 1, 0, 0);
        }

        if (i === 0) continue;
        const prev = positions.length / 2 - 2 * stride;
        const cur = prev + stride;
        // Wall, then apron — each a quad between this sample and the previous one.
        indices.push(prev, prev + 1, cur, prev + 1, cur + 1, cur);
        if (apron) indices.push(prev + 2, prev + 3, cur + 2, prev + 3, cur + 3, cur + 2);
      }
    }

    // Scree: loose stones on open ground below the apron, each a quad showing a piece
    // of the art's own rubble band. They are what breaks the straight line at the
    // foot of the wall — a gradient can only soften that line, not interrupt it.
    if (o.scree.perPx > 0) {
      const stepLen = contour.length / contour.points.length;
      let debt = 0;
      let stone = 0;
      for (const p of contour.points) {
        debt += stepLen * o.scree.perPx;
        const facing = smoothstep(o.facingLo, o.facingHi, p.ny);
        while (debt >= 1) {
          debt -= 1;
          stone++;
          if (facing < SCREE_FACING) continue;
          // Seeded on where the stone lands, not on its index, so it is a property of
          // the place: the same rock in the same spot on every peer and every rebuild.
          const sx = Math.round(p.x);
          const sy = Math.round(p.y);
          const drop = hashRange(sx, sy + stone, 0xa3, 0, 1);
          const foot = offsetPoint(p, o.apron * 0.4 + drop * o.scree.spread);
          const jitter = hashRange(sx, sy + stone, 0x91, -o.scree.spread / 2, o.scree.spread / 2);
          const size = hashRange(sx, sy + stone, 0xb5, o.scree.minSize, o.scree.maxSize);
          // Farther from the wall is fainter, so the scatter thins out instead of ending.
          const alpha = hashRange(sx, sy + stone, 0xc7, SCREE_ALPHA.min, SCREE_ALPHA.max) * (1 - drop * 0.75);
          // Any slice of the rubble band will do — the art has no orientation down there.
          const su = hashRange(sx, sy + stone, 0xd9, 0, o.repeatPx);

          const x = foot.x + jitter;
          const y = foot.y;
          const b = positions.length / 2;
          vertex(x, y, su, SCREE_V.top, alpha, 0);
          vertex(x + size, y, su + size, SCREE_V.top, alpha, 0);
          vertex(x + size, y + size, su + size, SCREE_V.bottom, alpha, 0);
          vertex(x, y + size, su, SCREE_V.bottom, alpha, 0);
          indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
    }
  }

  if (!indices.length) return null;

  return new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(positions), format: 'float32x2' },
      aU: { buffer: new Float32Array(us), format: 'float32' },
      aV: { buffer: new Float32Array(vs), format: 'float32' },
      aAlpha: { buffer: new Float32Array(alphas), format: 'float32' },
      aLip: { buffer: new Float32Array(lips), format: 'float32' },
    },
    indexBuffer: new Uint32Array(indices),
  });
}

/**
 * The stretches of a contour that carry a wall, as continuous strips.
 *
 * A segment is kept when **either** end faces south at all, so every arc ends on a
 * sample of zero facing — the wall tapers to nothing of its own accord rather than
 * being cut off. Arc length is carried unwrapped past the loop's end, so a strip that
 * crosses the contour's seam keeps a monotonic `u` instead of jumping back to zero.
 *
 * Exported through `cliffGeometry` only; the arcs are what makes the vertex budget
 * work, since roughly two thirds of any perimeter is not south-facing at all.
 */
function wallArcs(contour: Contour, o: CliffOptions): ArcSample[][] {
  const pts = contour.points;
  const n = pts.length;
  const facing = pts.map((p) => smoothstep(o.facingLo, o.facingHi, p.ny));
  if (!facing.some((f) => f > 0)) return [];

  const sample = (i: number, turns: number): ArcSample => ({
    p: pts[i],
    s: pts[i].s + turns * contour.length,
    facing: facing[i],
  });

  // The whole loop faces away from the light — only possible on a degenerate outline,
  // but it must not fall through the seam logic below as an open arc.
  if (facing.every((f) => f > 0)) {
    const all = pts.map((_, i) => sample(i, 0));
    all.push(sample(0, 1));
    return [all];
  }

  const arcs: ArcSample[][] = [];
  let current: ArcSample[] = [];
  let turns = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    if (next === 0) turns = 1; // past the seam: keep `s` climbing
    if (facing[i] > 0 || facing[next] > 0) {
      if (!current.length) current.push(sample(i, 0));
      current.push(sample(next, turns));
    } else if (current.length) {
      arcs.push(current);
      current = [];
    }
  }
  if (current.length) arcs.push(current);

  // An arc that ran off the end and one that started at the beginning are the same
  // arc, split by where the trace happened to open the loop.
  if (arcs.length > 1) {
    const last = arcs[arcs.length - 1];
    const first = arcs[0];
    if (last[last.length - 1].p === first[0].p) {
      arcs[arcs.length - 1] = last.concat(first.slice(1).map((a) => ({ ...a, s: a.s + contour.length })));
      arcs.shift();
    }
  }

  return arcs;
}
