import { Geometry } from 'pixi.js';
import { gameConfig } from '../../../../config/gameConfig';
import type { HeightField } from './geometry';

/**
 * The ground as **surface** rather than as outline — one triangle pair per tile,
 * drawn under the wireframe.
 *
 * The lattice says where the ground is; it cannot say that the ground is *solid*.
 * Every line in this view is the same weight whether it lies on the near slope of a
 * massif or three hundred px behind it, and the eye has nothing to separate them
 * with. A filled facet does that in the one way a wireframe never can: it has an
 * orientation, so it can be shaded, and a shaded facet reads as a plane the moment
 * it is next to another one at a different angle.
 *
 * **Flat-shaded, and therefore non-indexed.** Sharing corners between triangles is
 * the obvious economy and it is the wrong one here: a shared vertex has to carry one
 * normal, which averages the two faces meeting at it and turns the surface into a
 * smooth blob. Faceting is the look — the eye reads a field of discrete planes as
 * relief far more readily than it reads a gradient — so every triangle gets its own
 * three vertices and its own normal. The price is 3x the vertices of an indexed mesh
 * and it is a price of nothing: an 80x80 map is 12 800 triangles, which is a rounding
 * error of a frame on any GPU that runs this game.
 *
 * **Every tile, not `LINE_STRIDE`.** The lines are strided because a dense lattice
 * turns to noise at range; a surface has the opposite problem — strided quads would
 * cut the relief into 64 px steps and lose exactly the shape the fill exists to show.
 *
 * **Built once per match**, like the lines, and for the same reason: the projection
 * lives entirely in the vertex shader, so a frame is one buffer and one draw call
 * however far the hull has driven.
 *
 * What this pass deliberately does **not** do is hide the lines behind it. Drawn
 * additively, it is order-independent — which is what lets it stay one static buffer.
 * Hidden-line removal needs an opaque pass in back-to-front order, and that order
 * depends on where the eye *stands*, not merely where it looks, so it cannot be
 * baked. That is a separate change with a separate cost; see `.docs` and the plan.
 */

/** Direction the facets are lit from, in world space. Not physical — see `faceShade`. */
const LIGHT = { x: -0.45, y: -0.6, z: 0.66 };

/**
 * How much of a facet's brightness comes from its orientation, and how much it keeps
 * regardless.
 *
 * A pure Lambert term takes a facet facing away from the light to black, and black is
 * the one thing this surface must not be: it would punch holes in the ground that read
 * as terrain that is not there. Flat ground — which is most of the map — sits at
 * `dot(up, LIGHT)`, so the ambient floor is also what stops the plain from being the
 * brightest thing on the monitor.
 */
const AMBIENT = 0.35;

/** Lambert against `LIGHT`, floored — the shade one triangle is drawn at, 0..1. */
function faceShade(nx: number, ny: number, nz: number): number {
  const len = Math.hypot(nx, ny, nz) || 1;
  const lambert = (nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z) / len;
  return AMBIENT + (1 - AMBIENT) * Math.max(lambert, 0);
}

/** One triangle of the surface: three world corners, and the shade it is lit at. */
export interface Facet {
  /** `[x, y, h]` for each of the three corners, wound consistently. */
  corners: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  /** Lambert against `LIGHT`, floored by `AMBIENT` — 0..1. */
  shade: number;
}

/**
 * The surface, two triangles per tile.
 *
 * Heights come off the **drawn** field (`corner`, micro-relief included) so the facets
 * sit exactly on the lattice stroked over them; the shade comes off the same corners,
 * which is what makes the plain quietly uneven rather than one flat sheet of light.
 *
 * Pure, and returned rather than uploaded, for the same reason as `landformSegments`:
 * `fillGeometry` hands back a Pixi `Geometry` that no test in a node environment can
 * look inside.
 */
export function surfaceFacets(heights: HeightField): Facet[] {
  const { tilePx } = gameConfig.grid;
  const { tilesX, tilesY } = heights;
  const out: Facet[] = [];

  const push = (
    ax: number,
    ay: number,
    ah: number,
    bx: number,
    by: number,
    bh: number,
    cx: number,
    cy: number,
    ch: number,
  ): void => {
    // World-space normal of the triangle, +z up. The cross product of two of its
    // edges — the sign is fixed by the winding the caller uses, and both callers
    // below wind the same way, so the normals all point the same side of the ground.
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bh - ah;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = ch - ah;
    const shade = faceShade(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    out.push({ corners: [[ax, ay, ah], [bx, by, bh], [cx, cy, ch]], shade });
  };

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tilePx;
      const y0 = ty * tilePx;
      const x1 = x0 + tilePx;
      const y1 = y0 + tilePx;
      const h00 = heights.corner(tx, ty);
      const h10 = heights.corner(tx + 1, ty);
      const h01 = heights.corner(tx, ty + 1);
      const h11 = heights.corner(tx + 1, ty + 1);
      // Split along the diagonal that keeps the two halves closest to coplanar — the
      // other one bridges the tile's two extremes and puts a fold through the middle
      // of what should be a slope. Free here, and it is the difference between a
      // hillside and a field of dents.
      if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
        push(x0, y0, h00, x1, y0, h10, x1, y1, h11);
        push(x0, y0, h00, x1, y1, h11, x0, y1, h01);
      } else {
        push(x0, y0, h00, x1, y0, h10, x0, y1, h01);
        push(x1, y0, h10, x1, y1, h11, x0, y1, h01);
      }
    }
  }

  return out;
}

/** The same facets, uploaded — one non-indexed `triangle-list` buffer. */
export function fillGeometry(heights: HeightField): Geometry {
  const positions: number[] = [];
  const altitudes: number[] = [];
  const shades: number[] = [];

  for (const facet of surfaceFacets(heights)) {
    for (const [x, y, h] of facet.corners) {
      positions.push(x, y);
      altitudes.push(h);
      shades.push(facet.shade);
    }
  }

  return new Geometry({
    label: 'fpv-fill',
    attributes: {
      // Same split as the line buffer, and for the same reason: `Geometry.bounds`
      // reads `aPosition` in pairs and a 3-wide one would interleave altitude into
      // the bounding box.
      aPosition: { buffer: new Float32Array(positions), format: 'float32x2' },
      aHeight: { buffer: new Float32Array(altitudes), format: 'float32' },
      aShade: { buffer: new Float32Array(shades), format: 'float32' },
    },
    topology: 'triangle-list',
  });
}
