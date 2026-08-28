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

/**
 * How far a tile rises per step of Chebyshev depth into a mountain, in world px.
 *
 * **Set against the machine, not against the map.** A hull is 44-46 px of art and
 * the camera rides 62 px above the ground, so at the old 17 the tallest terrain in
 * the game — a depth-3 massif interior, 51 px — stood *below the pilot's eye*, and
 * a rim corner (one blocked tile averaged against three open ones) came out at 4 px.
 * A pilot drove into a swell, stopped, and nothing on the monitor said why. One
 * machine-length per step of depth makes the first step out of open ground as tall
 * as the thing looking at it, and a massif something to drive around.
 *
 * The price is on the far side of the same averaging: the foot ramp spills one tile
 * onto drivable ground, so a hull parked against a cliff now sits about `RISE/4`
 * up the slope with its camera and horizon lifted to match — 11 px where it used to
 * be 4. That is the cost of a surface that cannot tear; see `heightField`.
 */
const MOUNTAIN_RISE = 46;
/**
 * And how far it sinks per step into a crater. Shallower in the same proportion it
 * always was: a pit read from above the rim reads deeper than it is.
 *
 * A crater stops a robot exactly as a mountain does (`blocksMovement` is "not
 * open"), so it earns the same treatment — an edge, and enough depth to read as one.
 * What it must *not* gain is cover: only a mountain blocks a shot, and nothing here
 * touches that.
 */
const CRATER_DROP = 30;

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

/**
 * Draw a cliff rib every N contour samples — the same cost lever as `LINE_STRIDE`,
 * for the pass that answers "why can I not drive through this".
 *
 * The crest cannot be strided: skip a sample and it stops being the outline. A rib
 * can, because its job is to say *vertical*, and one every second sample (64 px of
 * perimeter) says it as clearly as one every sample while adding half as much to a
 * buffer this view can only afford because it is built once.
 */
const CLIFF_RIB_STRIDE = 2;

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

/** One straight piece of the buffer: two map positions, and a height at each. */
export interface Segment {
  x0: number;
  y0: number;
  h0: number;
  x1: number;
  y1: number;
  h1: number;
}

/**
 * Every landform drawn as a **cliff**: a foot, a crest, and the ribs between them.
 *
 * This is the pass that answers the pilot's question. The grid carries shape, but a
 * lattice draped on a height field is a function graph — it cannot contain a
 * vertical line, and a wireframe with no vertical line in it cannot read as a wall
 * however tall the ground behind it gets. So the boundary is drawn three times:
 *
 * - the **foot**, riding the surface, exactly the line the hull will stop at;
 * - the **crest**, the same outline at the height of the tiles just inside it;
 * - the **ribs**, joining the two — the only segments in this buffer that go up.
 *
 * The crest is one height all the way round, and that is not an approximation:
 * `depthField` measures distance from open ground, so every tile touching the
 * outline is at depth exactly 1. A massif's summit rises *behind* its rim rather
 * than at it, which is the same thing the top view says with `peakLayer` — bigger
 * landform, bigger summit — and the two views are read one keypress apart.
 *
 * Pure, and returned rather than stroked, because `terrainGeometry` hands back a
 * Pixi `Geometry` that no test in a node environment can look inside.
 */
export function landformSegments(terrain: TerrainGrid, heights: HeightField): Segment[] {
  const { tilePx } = gameConfig.grid;
  const out: Segment[] = [];

  for (const cluster of findClusters(terrain)) {
    // Up for a mountain, down for a crater — the rim's own tile height, which is
    // one step of depth by construction.
    const rim = cluster.kind === TerrainKind.Mountain ? MOUNTAIN_RISE : -CRATER_DROP;
    // Traced on the plain lattice, not the warped one the top view draws on
    // (`terrain/warp.ts`): the height field is defined at grid corners, and a
    // contour that wandered off them would float above or sink into its own ground.
    const contours = clusterContours(cluster, {
      corner: (cx, cy) => ({ x: cx * tilePx, y: cy * tilePx }),
      spacing: tilePx,
    });
    for (const contour of contours) {
      const pts = contour.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const ha = heights.at(a.x, a.y);
        out.push({ x0: a.x, y0: a.y, h0: ha, x1: b.x, y1: b.y, h1: heights.at(b.x, b.y) });
        out.push({ x0: a.x, y0: a.y, h0: rim, x1: b.x, y1: b.y, h1: rim });
        // The rib stands where the ground actually is, not at zero: the foot ramp
        // has already lifted (or sunk) the surface by the time it reaches here, and
        // a rib starting anywhere else would hang off its own cliff.
        if (i % CLIFF_RIB_STRIDE === 0) out.push({ x0: a.x, y0: a.y, h0: ha, x1: a.x, y1: a.y, h1: rim });
      }
    }
  }

  return out;
}

/**
 * The map as a wireframe: a strided grid over the relief, plus a cliff around every
 * landform.
 *
 * The two are doing different jobs and neither substitutes for the other. The grid
 * carries *shape* — it is the only thing that says the ground ahead rises — but at
 * `LINE_STRIDE` it cannot say where a mountain actually begins, because its lines
 * fall wherever the lattice put them. The landform pass is exactly that boundary,
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

  for (const s of landformSegments(terrain, heights)) lines.segment(s.x0, s.y0, s.h0, s.x1, s.y1, s.h1);

  return lines.build();
}
