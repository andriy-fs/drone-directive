import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { findClusters, type Cluster } from './clusters';
import { clusterContours, traceLoops } from './contours';

/** `.` open, `M` mountain — one string per row. */
function grid(...rows: string[]): TerrainGrid {
  return rows.map((row) => [...row].map((c) => (c === 'M' ? TerrainKind.Mountain : TerrainKind.Open)));
}

const TILE = 32;
/** Identity warp: these tests are about the trace, not about where `warp.ts` puts a corner. */
const options = { corner: (cx: number, cy: number) => ({ x: cx * TILE, y: cy * TILE }), spacing: 8 };

function only(...rows: string[]): Cluster {
  const clusters = findClusters(grid(...rows));
  expect(clusters).toHaveLength(1);
  return clusters[0];
}

/** How many tile sides of a cluster face something that is not the cluster. */
function boundarySides(cluster: Cluster): number {
  const inside = new Set(cluster.tiles.map((t) => `${t.tx},${t.ty}`));
  let n = 0;
  for (const t of cluster.tiles) {
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      if (!inside.has(`${t.tx + dx},${t.ty + dy}`)) n++;
    }
  }
  return n;
}

describe('traceLoops', () => {
  it('walks a single tile as one four-corner loop', () => {
    const loops = traceLoops(only('...', '.M.', '...'));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
  });

  it('does not put a corner where two tiles run straight through', () => {
    // Six corners, not eight: the shared edge is not a boundary at all.
    const loops = traceLoops(only('....', '.MM.', '....'));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it('gives a ring an outer loop and a hole', () => {
    const cluster = only('.....', '.MMM.', '.M.M.', '.MMM.', '.....');
    const loops = traceLoops(cluster);
    expect(loops).toHaveLength(2);
    expect(loops.reduce((n, l) => n + l.length, 0)).toBe(boundarySides(cluster));
  });

  it('wraps a diagonal pinch instead of cutting across it', () => {
    // The saddle: at corner (3,2) two tiles of the cluster meet on a diagonal and two
    // open cells meet on the other. Both of the corner's outgoing edges are available
    // and the walk has to choose. Taking the sharpest left keeps the rock on the right
    // and threads the notch; taking the other one would shortcut across the pinch and
    // leave the notch's own edges to be traced as a second loop lying *inside* the
    // rock, which every band offset from it would then be drawn on the wrong side of.
    const cluster = only('.....', '.MM..', '.M.M.', '.MMM.', '.....');
    const loops = traceLoops(cluster);
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(boundarySides(cluster));
    const pinch = loops[0].filter((c) => c.cx === 3 && c.cy === 2);
    expect(pinch).toHaveLength(2);
  });

  it('consumes every boundary side exactly once, pinches included', () => {
    const cluster = only('.....', '.MMM.', '.M.M.', '.MMM.', '.....');
    const loops = traceLoops(cluster);
    expect(loops.reduce((n, l) => n + l.length, 0)).toBe(boundarySides(cluster));
  });

  it('keeps two clusters that touch diagonally apart', () => {
    // `findClusters` is 4-connected, so these are two landforms and must trace as two.
    const clusters = findClusters(grid('....', '.M..', '..M.', '....'));
    expect(clusters).toHaveLength(2);
    for (const c of clusters) expect(traceLoops(c)).toHaveLength(1);
  });
});

describe('clusterContours', () => {
  it('resamples at roughly the spacing asked for, with arc length in step', () => {
    const [contour] = clusterContours(only('....', '.MM.', '....'), options);
    expect(contour.length).toBeCloseTo(6 * TILE, 5);
    expect(contour.points[0].s).toBe(0);
    for (let i = 1; i < contour.points.length; i++) {
      expect(contour.points[i].s).toBeGreaterThan(contour.points[i - 1].s);
    }
    const step = contour.length / contour.points.length;
    expect(step).toBeGreaterThan(options.spacing * 0.8);
    expect(step).toBeLessThan(options.spacing * 1.2);
  });

  it('points its normals out of the rock, and out means into a hole', () => {
    const contours = clusterContours(only('.....', '.MMM.', '.M.M.', '.MMM.', '.....'), options);
    expect(contours).toHaveLength(2);
    const hole = contours.find((c) => c.hole);
    const outer = contours.find((c) => !c.hole);
    expect(hole).toBeDefined();
    expect(outer).toBeDefined();
    if (!hole || !outer) return;

    // The hole's normals point at the ring's centre; the outer loop's point away.
    const centre = { x: 2.5 * TILE, y: 2.5 * TILE };
    for (const p of hole.points) {
      expect((centre.x - p.x) * p.nx + (centre.y - p.y) * p.ny).toBeGreaterThan(0);
    }
    for (const p of outer.points) {
      expect((centre.x - p.x) * p.nx + (centre.y - p.y) * p.ny).toBeLessThan(0);
    }
  });

  it('gives every sample a unit normal', () => {
    for (const contour of clusterContours(only('.....', '.MMM.', '.MM..', '.....'), options)) {
      for (const p of contour.points) expect(Math.hypot(p.nx, p.ny)).toBeCloseTo(1, 6);
    }
  });

  it('shades a straight edge exactly as its side would', () => {
    // Away from the corners the central difference must agree with the tile normal,
    // or the bevel would light a flat run of boundary as if it were curved.
    const [contour] = clusterContours(only('.....', '.MMM.', '.....'), options);
    const north = contour.points.filter((p) => p.y === TILE && p.x > 1.3 * TILE && p.x < 3.7 * TILE);
    expect(north.length).toBeGreaterThan(0);
    for (const p of north) {
      expect(p.nx).toBeCloseTo(0, 6);
      expect(p.ny).toBeCloseTo(-1, 6);
    }
  });

  it('traces the same outline twice', () => {
    const rows = ['.....', '.MMM.', '.M.M.', '.MMM.', '.....'];
    expect(clusterContours(only(...rows), options)).toEqual(clusterContours(only(...rows), options));
  });
});
