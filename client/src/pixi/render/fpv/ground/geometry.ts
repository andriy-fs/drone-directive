import { Geometry } from 'pixi.js';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import type { TerrainGrid } from '../../../../engine/obstacles';
import { clusterContours } from '../../terrain/contours';
import { depthField, findClusters } from '../../terrain/clusters';

/**
 * The ground the wireframe view draws: a height for every grid corner, and one
 * static `Geometry` of line segments over it.
 *
 * **The height field is not computed here — it is read off the top view's.**
 * `findClusters` + `depthField` is a distance transform, and a distance transform
 * already answers the only question a relief needs answering: how deep inside its
 * own landform a tile sits. The top view spends that answer on shading; this one
 * spends it on altitude. Two derivations of "how tall is this mountain" would be
 * two things to keep in agreement for no gain — and the agreement is visible,
 * since the player switches between the two views by tapping one key.
 *
 * **Built once per match.** Nothing here runs per frame: the entire projection is
 * in the vertex shader, so a frame is one buffer and one draw call however far the
 * hull has driven. That is the whole reason the view can afford to draw the map
 * rather than a sector of it.
 */

/** How far a tile rises per step of Chebyshev depth into a mountain, in world px. */
const MOUNTAIN_RISE = 17;
/** And how far it sinks per step into a crater. Shallower: a pit read from above the rim reads deeper than it is. */
const CRATER_DROP = 11;

/**
 * Draw a grid line every N tile boundaries — **the cost lever of this whole view.**
 *
 * A line on every boundary of an 80×80 map is ~13 000 segments; every second one is
 * ~3 400 and the difference is plainly visible in a p95. It is also a legibility
 * lever in the same direction, and not obviously the same way round: a fine grid
 * carries more relief but turns to moiré at the far end of the monitor, where the
 * distance fade is already fighting to keep the picture from becoming noise.
 *
 * Perpendicular subdivision is *not* strided — a line running east is still cut at
 * every tile boundary it crosses, so it follows the ground whatever the spacing of
 * its neighbours. Only the number of lines changes.
 */
const LINE_STRIDE = 2;

/** Heights sampled two ways: at a grid corner, and anywhere at all. */
export interface HeightField {
  /** Grid dimensions in tiles, as the terrain came in. */
  tilesX: number;
  tilesY: number;
  /** Height at a grid corner, in world px, **+up**. Out of range reads as ground level. */
  corner(cx: number, cy: number): number;
  /** Height at any world position, bilinear between corners. Clamped to the map. */
  at(x: number, y: number): number;
}

/**
 * Height for every grid corner of the map.
 *
 * A **corner** is the average of the up-to-four tiles that touch it, with anything
 * off the map counting as ground level. That average is what makes this a surface
 * rather than a set of blocks: adjacent quads share their corners by construction,
 * so the mesh cannot tear, and a landform's edge becomes a ramp down to open ground
 * over the last tile instead of a wall with nothing drawn on it. It also scales the
 * relief by *size* for free — the depth transform already makes a big massif deeper
 * than a small one, and averaging makes a lone bump lower than either.
 *
 * The price is that the ramp spills one tile past the tiles that are actually
 * blocked, so the ground beside a cliff is not quite flat. In a wireframe that
 * reads as a foot, which is what it is.
 */
export function heightField(terrain: TerrainGrid): HeightField {
  const tilesY = terrain.length;
  const tilesX = tilesY > 0 ? terrain[0].length : 0;
  const tiles = new Float32Array(tilesX * tilesY);

  for (const cluster of findClusters(terrain)) {
    const depth = depthField(cluster);
    const scale = cluster.kind === TerrainKind.Mountain ? MOUNTAIN_RISE : -CRATER_DROP;
    for (const t of cluster.tiles) tiles[t.ty * tilesX + t.tx] = scale * depth.at(t.tx, t.ty);
  }

  const tileAt = (tx: number, ty: number): number =>
    tx < 0 || ty < 0 || tx >= tilesX || ty >= tilesY ? 0 : tiles[ty * tilesX + tx];

  const corners = new Float32Array((tilesX + 1) * (tilesY + 1));
  for (let cy = 0; cy <= tilesY; cy++) {
    for (let cx = 0; cx <= tilesX; cx++) {
      const sum = tileAt(cx - 1, cy - 1) + tileAt(cx, cy - 1) + tileAt(cx - 1, cy) + tileAt(cx, cy);
      corners[cy * (tilesX + 1) + cx] = sum / 4;
    }
  }

  const corner = (cx: number, cy: number): number => {
    if (cx < 0 || cy < 0 || cx > tilesX || cy > tilesY) return 0;
    return corners[cy * (tilesX + 1) + cx];
  };

  const { tilePx } = gameConfig.grid;
  return {
    tilesX,
    tilesY,
    corner,
    at(x, y) {
      const gx = Math.min(Math.max(x / tilePx, 0), tilesX);
      const gy = Math.min(Math.max(y / tilePx, 0), tilesY);
      const cx = Math.min(Math.floor(gx), tilesX - 1);
      const cy = Math.min(Math.floor(gy), tilesY - 1);
      const fx = gx - cx;
      const fy = gy - cy;
      const top = corner(cx, cy) * (1 - fx) + corner(cx + 1, cy) * fx;
      const bottom = corner(cx, cy + 1) * (1 - fx) + corner(cx + 1, cy + 1) * fx;
      return top * (1 - fy) + bottom * fy;
    },
  };
}

/** Accumulates world-space line segments into one non-indexed `line-list` buffer. */
class LineBuilder {
  private readonly positions: number[] = [];
  private readonly heights: number[] = [];

  segment(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): void {
    this.positions.push(x0, y0, x1, y1);
    this.heights.push(h0, h1);
  }

  get segments(): number {
    return this.heights.length / 2;
  }

  build(): Geometry {
    return new Geometry({
      label: 'fpv-terrain',
      attributes: {
        // Position stays 2D with height on its own attribute rather than becoming a
        // `float32x3`: `Geometry.bounds` reads `aPosition` in pairs, and a 3-wide one
        // would hand Pixi a bounding box interleaved out of x, y and altitude.
        aPosition: { buffer: new Float32Array(this.positions), format: 'float32x2' },
        aHeight: { buffer: new Float32Array(this.heights), format: 'float32' },
      },
      topology: 'line-list',
    });
  }
}

/**
 * The map as a wireframe: a strided grid over the relief, plus the outline of every
 * landform.
 *
 * The two are doing different jobs and neither substitutes for the other. The grid
 * carries *shape* — it is the only thing that says the ground ahead rises — but at
 * `LINE_STRIDE` it cannot say where a mountain actually begins, because its lines
 * fall wherever the lattice put them. The contours are exactly that boundary,
 * traced by `clusterContours` from the same loops the top view bevels, so what the
 * player reads as the foot of a massif is the line their hull will actually stop at.
 */
export function terrainGeometry(terrain: TerrainGrid, heights: HeightField): Geometry {
  const { tilePx } = gameConfig.grid;
  const { tilesX, tilesY } = heights;
  const lines = new LineBuilder();

  // Grid lines. Every strided row, and the far edge whether or not the stride
  // lands on it — a map ending one line short reads as a rendering fault.
  const boundaries = (extent: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < extent; i += LINE_STRIDE) out.push(i);
    if (out[out.length - 1] !== extent) out.push(extent);
    return out;
  };

  for (const cy of boundaries(tilesY)) {
    for (let cx = 0; cx < tilesX; cx++) {
      lines.segment(cx * tilePx, cy * tilePx, heights.corner(cx, cy), (cx + 1) * tilePx, cy * tilePx, heights.corner(cx + 1, cy));
    }
  }
  for (const cx of boundaries(tilesX)) {
    for (let cy = 0; cy < tilesY; cy++) {
      lines.segment(cx * tilePx, cy * tilePx, heights.corner(cx, cy), cx * tilePx, (cy + 1) * tilePx, heights.corner(cx, cy + 1));
    }
  }

  // Landform outlines. Traced on the plain lattice, not the warped one the top view
  // draws on (`terrain/warp.ts`): the height field is defined at grid corners, and a
  // contour that wandered off them would float above or sink into its own ground.
  for (const cluster of findClusters(terrain)) {
    const contours = clusterContours(cluster, {
      corner: (cx, cy) => ({ x: cx * tilePx, y: cy * tilePx }),
      spacing: tilePx,
    });
    for (const contour of contours) {
      const pts = contour.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        lines.segment(a.x, a.y, heights.at(a.x, a.y), b.x, b.y, heights.at(b.x, b.y));
      }
    }
  }

  return lines.build();
}
