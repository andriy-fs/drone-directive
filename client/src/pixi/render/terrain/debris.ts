import { Geometry } from 'pixi.js';
import type { Contour } from './contours';
import { offsetPoint, smoothstep } from './contours';
import { hashRange } from './hash';

/**
 * The loose stone lying at the foot of a mountain — a scatter of small quads on open
 * ground, below the stretches of the cluster's contour that face away from the light.
 *
 * **What this is left over from.** A rock *wall* used to stand here: a strip of baked
 * cliff art along the same arcs, with this rubble spilling out of its base. The wall
 * is gone — seen from straight overhead it read as a second piece of art, lit its own
 * way, pasted along the silhouette, and the mass now has to say "tall" through the
 * fill, the peaks and the bevel instead. The debris stayed on purpose: it is the only
 * thing in the layer with a silhouette of its own, so it is the only thing that can
 * *interrupt* the line the footprint draws rather than merely soften it.
 *
 * **Where it goes is still a lighting question.** Stone collects below the faces
 * turned away from the light, which is what `facing` weights — due south gets the
 * full scatter, a stretch turning east or west gets none. Every stone is placed from
 * a hash of the ground it lands on, so two peers and two rebuilds agree.
 */
export interface DebrisOptions {
  /** How much of the fill one stone's crop covers, in px — the fill's own repeat length. */
  repeatPx: number;
  /** Outward-normal `ny` at which debris starts, and at which it is at full strength. */
  facingLo: number;
  facingHi: number;
  /** Stones per px of contour, their size range, and how far out they scatter. */
  scree: { perPx: number; minSize: number; maxSize: number; spread: number };
  /** How far out from the footprint the scatter starts, in px. */
  reach: number;
}

/** Corners on a stone. Enough to read as broken rock, few enough to stay cheap. */
const CORNERS = 6;
/** How far a corner may be pulled in from the stone's nominal radius, as a fraction of it. */
const RAGGED = 0.45;

/** Alpha a stone starts at, before it is faded by how far from the mass it landed. */
const ALPHA = { min: 0.55, max: 0.9 } as const;
/** Below this facing a stretch of contour is bare ground as far as the debris is concerned. */
const FACING_CUT = 0.3;

/**
 * Builds one `Geometry` for every contour given, or `null` if there is nothing to
 * draw. Attributes are `aPosition`, `aUv` (a crop of the fill, in repeat units) and
 * `aAlpha`.
 *
 * Each stone samples the fill somewhere else than where it lies. Sampling it in world
 * space — which is how the mass itself is drawn — would make a huddle of stones show
 * one continuous piece of rock and read as a hole in the ground rather than as chips
 * on top of it.
 */
export function debrisGeometry(contours: readonly Contour[], o: DebrisOptions): Geometry | null {
  const positions: number[] = [];
  const uvs: number[] = [];
  const alphas: number[] = [];
  const indices: number[] = [];

  const vertex = (x: number, y: number, u: number, v: number, a: number): void => {
    positions.push(x, y);
    uvs.push(u, v);
    alphas.push(a);
  };

  for (const contour of contours) {
    if (o.scree.perPx <= 0) continue;
    const stepLen = contour.length / contour.points.length;
    let debt = 0;
    let stone = 0;

    for (const p of contour.points) {
      debt += stepLen * o.scree.perPx;
      const facing = smoothstep(o.facingLo, o.facingHi, p.ny);
      while (debt >= 1) {
        debt -= 1;
        stone++;
        if (facing < FACING_CUT) continue;

        // Seeded on where the stone lands, not on its index, so it is a property of
        // the place: the same rock in the same spot on every peer and every rebuild.
        const sx = Math.round(p.x);
        const sy = Math.round(p.y);
        const drop = hashRange(sx, sy + stone, 0xa3, 0, 1);
        const foot = offsetPoint(p, o.reach + drop * o.scree.spread);
        const jitter = hashRange(sx, sy + stone, 0x91, -o.scree.spread / 2, o.scree.spread / 2);
        const size = hashRange(sx, sy + stone, 0xb5, o.scree.minSize, o.scree.maxSize);
        // Farther from the mass is fainter, so the scatter thins out instead of ending.
        const alpha = hashRange(sx, sy + stone, 0xc7, ALPHA.min, ALPHA.max) * (1 - drop * 0.75);
        // This stone's own crop of the fill.
        const u0 = hashRange(sx, sy + stone, 0xd9, 0, 1);
        const v0 = hashRange(sx, sy + stone, 0xe5, 0, 1);

        const x = foot.x + jitter;
        const y = foot.y;
        const spin = hashRange(sx, sy + stone, 0xf7, 0, Math.PI * 2);

        // An irregular polygon, not a quad. A square of rock texture is a square, and
        // a scatter of squares is the tile grid this whole layer exists to hide — the
        // stones are here for their silhouettes, so the silhouette has to live in the
        // geometry now that it is no longer in a sheet's alpha.
        const centre = positions.length / 2;
        vertex(x, y, u0, v0, alpha);
        for (let c = 0; c < CORNERS; c++) {
          const a = spin + (c / CORNERS) * Math.PI * 2;
          const r = (size / 2) * (1 - RAGGED * hashRange(sx + c, sy + stone, 0x2f, 0, 1));
          const ox = Math.cos(a) * r;
          const oy = Math.sin(a) * r;
          vertex(x + ox, y + oy, u0 + ox / o.repeatPx, v0 + oy / o.repeatPx, alpha);
        }
        for (let c = 0; c < CORNERS; c++) {
          indices.push(centre, centre + 1 + c, centre + 1 + ((c + 1) % CORNERS));
        }
      }
    }
  }

  if (!indices.length) return null;

  return new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array(positions), format: 'float32x2' },
      aUv: { buffer: new Float32Array(uvs), format: 'float32x2' },
      aAlpha: { buffer: new Float32Array(alphas), format: 'float32' },
    },
    indexBuffer: new Uint32Array(indices),
  });
}
