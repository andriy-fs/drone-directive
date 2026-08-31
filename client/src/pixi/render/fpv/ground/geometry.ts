import { Geometry } from 'pixi.js';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import type { TerrainGrid } from '../../../../engine/obstacles';
import { clusterContours } from '../../terrain/contours';
import { depthField, findClusters } from '../../terrain/clusters';
import { hashRange } from '../../terrain/hash';

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
export const MOUNTAIN_RISE = 46;
/**
 * And how far it sinks per step into a crater. Shallower in the same proportion it
 * always was: a pit read from above the rim reads deeper than it is.
 *
 * A crater stops a robot exactly as a mountain does (`blocksMovement` is "not
 * open"), so it earns the same treatment — an edge, and enough depth to read as one.
 * What it must *not* gain is cover: only a mountain blocks a shot, and nothing here
 * touches that.
 */
export const CRATER_DROP = 30;

/**
 * How far open ground wanders from dead level, in world px — **the only thing that
 * makes the plain a surface rather than a sheet of graph paper.**
 *
 * Everything else in this file derives height from the distance transform, which is
 * zero everywhere a robot can drive. That is honest and it looks wrong: a lattice of
 * perfectly straight lines over a perfectly flat field gives the eye no parallax at
 * all, so driving across open ground reads as the grid sliding rather than the hull
 * moving.
 *
 * **Five px, and it has been set twice for two different pictures.** Three was worth
 * nothing while this view was pure wireframe: a grid cell is 64 px across, so three px
 * of wander tilts a line by under three degrees — real in the buffer, invisible on the
 * monitor, which is the worst place for a number to be. Nine fixed that, and then
 * `ground/fill.ts` arrived and changed what the number means. A lit surface does not
 * read wander as *direction*, it reads it as *shade*, and shading is far the more
 * sensitive of the two: at nine px the facets on open ground came out spread across
 * 40% of the brightness range, so the plain mottled. Five keeps that spread near a
 * fifth — see the test — while the fill's own lighting does the work the lattice used
 * to have to do alone. It is a ninth of one step of `MOUNTAIN_RISE`, so a swell still
 * out-reads the plain by an order of magnitude.
 *
 * **What the camera rides is `baseAt`, not `at`.** A pilot's eye sits 62 px up; nine
 * px of ground under it is a seventh of that, and putting it there would swing the
 * horizon every time the hull crossed a corner. The wobble belongs to the drawing,
 * not to the point of view.
 *
 * **Only strictly interior corners with four open tiles get it, and that rule is
 * load-bearing.** A corner touching a blocked tile keeps its analytic height exactly,
 * which is what lets the foot, the crest and every rib in `landformSegments` stand on
 * numbers that have not been jittered — a cliff that shivered against its own ground
 * would be worse than a flat plain. The map's outer boundary is excluded for the same
 * kind of reason: it is the edge of the world, and it should read as a drawn line.
 */
export const MICRO_PX = 5;

/** Salt for the micro-relief hash — see `terrain/warp.ts` for why these are per-use. */
const SALT_MICRO = 0x5b3;

/**
 * The steepest slope the shader is asked to shade, as a rise over run.
 *
 * A cliff rib is vertical: zero run, so its slope is not a number. It is also the one
 * segment in the buffer that most needs to be bright — it is the whole answer to "why
 * can I not drive through this" — so rather than special-casing it downstream,
 * `slopeOf` reports the ceiling for it, and the ceiling is set where a real slope can
 * plausibly reach: one step of `MOUNTAIN_RISE` over less than half a tile.
 */
export const SLOPE_MAX = 2;

/**
 * Draw a fall line on every N-th tile of a landform — the cost lever of that pass.
 *
 * One, not two. Each hair is half a tile long and lands on a flank the fade is already
 * dimming, so at every second tile the hatching read as scattered specks rather than
 * as a surface. The pass is a few hundred segments on a real map either way.
 */
const FALL_STRIDE = 1;

/**
 * How long one is, as a fraction of a tile.
 *
 * **Half, and the half matters.** The descent is the gradient of one bilinear patch,
 * measured at that patch's centre, and it is only true inside the patch: run the hair
 * a whole tile and it crosses into the next cell, where the ground is bending a
 * different way. That produced hairs that ended at the height they started — a fall
 * line lying along a contour, saying the exact opposite of the one thing it is for.
 * Kept inside its own cell it descends by construction, and it also stops floating
 * over ground that curves away underneath a straight segment.
 */
const FALL_LENGTH = 0.5;

/**
 * How steep a tile must be before it earns one, as a rise over run.
 *
 * A summit is flat by construction (the distance transform plateaus in the middle of
 * a big massif) and a lone bump is flat by averaging. Neither has any fall to draw,
 * and a zero-length hair standing on one would read as dirt on the monitor.
 */
const FALL_MIN_SLOPE = 0.15;

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
export const LINE_STRIDE = 2;

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
  /**
   * The same corner **without the micro-relief** — the analytic landform on its own.
   *
   * This is what shading has to read. Brightness in the fragment stage keys off slope,
   * and `MICRO_PX` puts a slope on every square inch of open ground: shade the drawn
   * field and the plain lights up as evenly as a cliff, which is the two features
   * cancelling each other out. Draw the relief, shade the landform.
   */
  baseCorner(cx: number, cy: number): number;
  /** Height at any world position, bilinear between corners. Clamped to the map. */
  at(x: number, y: number): number;
  /**
   * The same position on the **analytic** surface — the landform with no micro-relief
   * on it. What anything that *rides* the ground should read, the camera above all:
   * `MICRO_PX` is a ninth of the pilot's eye height, and a viewpoint that took it
   * literally would swing the horizon every time the hull crossed a grid corner.
   */
  baseAt(x: number, y: number): number;
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

  const base = new Float32Array((tilesX + 1) * (tilesY + 1));
  for (let cy = 0; cy <= tilesY; cy++) {
    for (let cx = 0; cx <= tilesX; cx++) {
      const sum = tileAt(cx - 1, cy - 1) + tileAt(cx, cy - 1) + tileAt(cx - 1, cy) + tileAt(cx, cy);
      base[cy * (tilesX + 1) + cx] = sum / 4;
    }
  }

  // The drawn field: the landform, plus a little wander on ground that is nothing but
  // ground. Interior corners only, and only where all four tiles are open — see
  // `MICRO_PX` for why a corner that touches a cliff must keep its exact height.
  const corners = Float32Array.from(base);
  for (let cy = 1; cy < tilesY; cy++) {
    for (let cx = 1; cx < tilesX; cx++) {
      const open =
        tileAt(cx - 1, cy - 1) === 0 && tileAt(cx, cy - 1) === 0 && tileAt(cx - 1, cy) === 0 && tileAt(cx, cy) === 0;
      if (open) corners[cy * (tilesX + 1) + cx] += hashRange(cx, cy, SALT_MICRO, -MICRO_PX, MICRO_PX);
    }
  }

  const sample = (field: Float32Array) => (cx: number, cy: number): number => {
    if (cx < 0 || cy < 0 || cx > tilesX || cy > tilesY) return 0;
    return field[cy * (tilesX + 1) + cx];
  };
  const corner = sample(corners);
  const baseCorner = sample(base);

  const { tilePx } = gameConfig.grid;
  const bilinear = (of: (cx: number, cy: number) => number) => (x: number, y: number): number => {
    const gx = Math.min(Math.max(x / tilePx, 0), tilesX);
    const gy = Math.min(Math.max(y / tilePx, 0), tilesY);
    const cx = Math.min(Math.floor(gx), tilesX - 1);
    const cy = Math.min(Math.floor(gy), tilesY - 1);
    const fx = gx - cx;
    const fy = gy - cy;
    const top = of(cx, cy) * (1 - fx) + of(cx + 1, cy) * fx;
    const bottom = of(cx, cy + 1) * (1 - fx) + of(cx + 1, cy + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };

  return { tilesX, tilesY, corner, baseCorner, at: bilinear(corner), baseAt: bilinear(baseCorner) };
}

/**
 * How steep a segment is, as a rise over run, clamped to `SLOPE_MAX`.
 *
 * The number the fragment stage brightens by. Fed **base** heights for the grid pass,
 * because micro-relief is relief and not landform (see `HeightField.baseCorner`); fed
 * the segment's own heights everywhere else, where the two are equal anyway — every
 * contour point sits on a corner that touches a blocked tile, and those keep their
 * analytic height exactly.
 *
 * A segment with no run at all is a cliff rib rather than a degenerate line: it is
 * drawn deliberately, it is the only vertical in the buffer, and it takes the ceiling.
 */
export function slopeOf(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): number {
  const run = Math.hypot(x1 - x0, y1 - y0);
  if (run < 1e-6) return SLOPE_MAX;
  return Math.min(Math.abs(h1 - h0) / run, SLOPE_MAX);
}

/** Accumulates world-space line segments into one non-indexed `line-list` buffer. */
class LineBuilder {
  private readonly positions: number[] = [];
  private readonly heights: number[] = [];
  private readonly slopes: number[] = [];

  segment(x0: number, y0: number, h0: number, x1: number, y1: number, h1: number, slope: number): void {
    this.positions.push(x0, y0, x1, y1);
    this.heights.push(h0, h1);
    // Flat along its own length, so both ends carry the one value — the varying is
    // constant across the line and the interpolator has nothing to do.
    this.slopes.push(slope, slope);
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
        aSlope: { buffer: new Float32Array(this.slopes), format: 'float32' },
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
 * The **fall lines**: one short hair down the steepest descent of every N-th tile of
 * every landform.
 *
 * The three passes answer three different questions and none of them substitutes for
 * another. The grid says *there is shape here*; the cliff says *this is where it
 * starts and you will stop at it*; this one says **which way is down** — the thing a
 * lattice draped over a height field genuinely cannot say, because its lines run along
 * the axes whatever the ground under them does. On the flank of a massif that is the
 * difference between a mesh that has volume and one that reads as a folded sheet.
 *
 * Each hair runs half a tile from the centre of its own — see `FALL_LENGTH`.
 *
 * Steepest descent is taken from the **base** field: micro-relief would swing the
 * gradient of a nearly flat tile by tens of degrees and scatter the hairs into noise.
 * The drawn endpoints come off `at()` all the same, so each one still lies on the
 * surface the rest of the buffer draws.
 *
 * Pure and returned rather than stroked, for the same reason as `landformSegments`.
 */
export function fallLineSegments(terrain: TerrainGrid, heights: HeightField): Segment[] {
  const { tilePx } = gameConfig.grid;
  const out: Segment[] = [];

  for (const cluster of findClusters(terrain)) {
    for (const t of cluster.tiles) {
      if ((t.tx + t.ty) % FALL_STRIDE !== 0) continue;
      // Central differences over the tile's own four corners — the gradient of the
      // bilinear patch at its centre, which is exactly what `at()` interpolates.
      const h00 = heights.baseCorner(t.tx, t.ty);
      const h10 = heights.baseCorner(t.tx + 1, t.ty);
      const h01 = heights.baseCorner(t.tx, t.ty + 1);
      const h11 = heights.baseCorner(t.tx + 1, t.ty + 1);
      const gx = (h10 + h11 - h00 - h01) / (2 * tilePx);
      const gy = (h01 + h11 - h00 - h10) / (2 * tilePx);
      const grade = Math.hypot(gx, gy);
      if (grade < FALL_MIN_SLOPE) continue;

      const x0 = (t.tx + 0.5) * tilePx;
      const y0 = (t.ty + 0.5) * tilePx;
      // Downhill is against the gradient — for a crater that points inward, which is
      // correct: a pit falls away from its rim exactly as a mountain falls away from
      // its summit, and both want the hair pointing the way the ground goes.
      const reach = tilePx * FALL_LENGTH;
      const x1 = x0 - (gx / grade) * reach;
      const y1 = y0 - (gy / grade) * reach;
      out.push({ x0, y0, h0: heights.at(x0, y0), x1, y1, h1: heights.at(x1, y1) });
    }
  }

  return out;
}

/**
 * The map as a wireframe: a strided grid over the relief, plus a cliff around every
 * landform.
 *
 * The three passes are doing different jobs and none substitutes for another. The grid
 * carries *shape* — it is the only thing that says the ground ahead rises — but at
 * `LINE_STRIDE` it cannot say where a mountain actually begins, because its lines
 * fall wherever the lattice put them. The landform pass is exactly that boundary,
 * traced by `clusterContours` from the same loops the top view bevels, so what the
 * player reads as the foot of a massif is the line their hull will actually stop at.
 * The fall lines carry the flank between the two.
 *
 * Every segment also carries a slope, and that is not decoration either: a wireframe
 * of one brightness is a drawing with no shading in it at all, so a wall, its apron
 * and the flat beside them arrive at the eye as the same grey. `slopeOf` is what lets
 * the fragment stage tell them apart.
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

  // Drawn on the relief, shaded off the landform under it — the two fields differ by
  // `MICRO_PX` on open ground and nowhere else.
  const gridLine = (cx0: number, cy0: number, cx1: number, cy1: number): void => {
    const x0 = cx0 * tilePx;
    const y0 = cy0 * tilePx;
    const x1 = cx1 * tilePx;
    const y1 = cy1 * tilePx;
    const slope = slopeOf(x0, y0, heights.baseCorner(cx0, cy0), x1, y1, heights.baseCorner(cx1, cy1));
    lines.segment(x0, y0, heights.corner(cx0, cy0), x1, y1, heights.corner(cx1, cy1), slope);
  };

  for (const cy of boundaries(tilesY)) {
    for (let cx = 0; cx < tilesX; cx++) gridLine(cx, cy, cx + 1, cy);
  }
  for (const cx of boundaries(tilesX)) {
    for (let cy = 0; cy < tilesY; cy++) gridLine(cx, cy, cx, cy + 1);
  }

  for (const s of [...landformSegments(terrain, heights), ...fallLineSegments(terrain, heights)]) {
    lines.segment(s.x0, s.y0, s.h0, s.x1, s.y1, s.h1, slopeOf(s.x0, s.y0, s.h0, s.x1, s.y1, s.h1));
  }

  return lines.build();
}
