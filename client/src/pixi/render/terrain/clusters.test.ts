import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';
import { boundaryEdges, depthField, findClusters, peakAnchors } from './clusters';

/** `.` open, `M` mountain, `C` crater — one string per row. */
function grid(...rows: string[]): TerrainGrid {
  return rows.map((row) =>
    [...row].map((c) => (c === 'M' ? TerrainKind.Mountain : c === 'C' ? TerrainKind.Crater : TerrainKind.Open)),
  );
}

describe('findClusters', () => {
  it('keeps touching clusters of different kinds apart', () => {
    // The renderer shades a cluster as rising or sinking; one silhouette spanning
    // both kinds could not be shaded either way.
    const clusters = findClusters(grid('MMCC', '....'));
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.kind)).toEqual([TerrainKind.Mountain, TerrainKind.Crater]);
    expect(clusters.every((c) => c.tiles.length === 2)).toBe(true);
  });

  it('does not fuse blobs that only meet at a corner', () => {
    // 8-connectivity would make these one cluster, and its cast shadow would then
    // stretch across the open tiles units drive through.
    const clusters = findClusters(grid('M.', '.M'));
    expect(clusters).toHaveLength(2);
  });

  it('finds a single-cell cluster with a degenerate bbox', () => {
    const [cluster] = findClusters(grid('...', '.M.', '...'));
    expect(cluster.tiles).toEqual([{ tx: 1, ty: 1 }]);
    expect(cluster.bbox).toEqual({ minTx: 1, minTy: 1, maxTx: 1, maxTy: 1 });
  });

  it('returns nothing for an empty field', () => {
    expect(findClusters(grid('..', '..'))).toEqual([]);
  });

  it('is deterministic in cluster and tile order', () => {
    const rows = ['M.C', '.M.', 'CC.'];
    expect(findClusters(grid(...rows))).toEqual(findClusters(grid(...rows)));
  });
});

describe('boundaryEdges', () => {
  it('gives an isolated cell all four sides', () => {
    expect(boundaryEdges(grid('...', '.M.', '...'), TerrainKind.Mountain)).toHaveLength(4);
  });

  it('drops the shared edge between two cells of the same kind', () => {
    // Two cells: 8 sides in total, minus the two facing each other.
    expect(boundaryEdges(grid('MM'), TerrainKind.Mountain)).toHaveLength(6);
  });

  it('treats the map edge as a boundary', () => {
    // A cell in the corner still gets four edges: past the world is not more rock.
    const edges = boundaryEdges(grid('M.', '..'), TerrainKind.Mountain);
    expect(edges).toHaveLength(4);
    expect(edges.map((e) => e.side).sort()).toEqual(['e', 'n', 's', 'w']);
  });

  it('counts a neighbouring cell of the other kind as a boundary', () => {
    expect(boundaryEdges(grid('MC'), TerrainKind.Mountain)).toHaveLength(4);
  });
});

describe('depthField', () => {
  it('marks every tile of a one-wide strip as boundary', () => {
    const [cluster] = findClusters(grid('.....', '.MMM.', '.....'));
    const depth = depthField(cluster);
    expect(depth.max).toBe(1);
    for (const t of cluster.tiles) expect(depth.at(t.tx, t.ty)).toBe(1);
  });

  it('deepens toward the middle of a thick blob', () => {
    const [cluster] = findClusters(grid('.....', '.MMM.', '.MMM.', '.MMM.', '.....'));
    const depth = depthField(cluster);
    expect(depth.at(2, 2)).toBe(2);
    expect(depth.at(1, 1)).toBe(1);
    expect(depth.max).toBe(2);
  });

  it('treats the map edge as open, so a cluster against it does not read as deep', () => {
    // 3×3 of mountain pressed into the corner. If out-of-bounds counted as rock,
    // the corner tile would come out interior and get a summit on the map border.
    const [cluster] = findClusters(grid('MMM.', 'MMM.', 'MMM.', '....'));
    const depth = depthField(cluster);
    expect(depth.at(0, 0)).toBe(1);
    expect(depth.at(1, 1)).toBe(2);
  });

  it('returns 0 outside the cluster', () => {
    const [cluster] = findClusters(grid('.M.'));
    expect(cluster.tiles).toHaveLength(1);
    expect(depthField(cluster).at(0, 0)).toBe(0);
  });
});

describe('peakAnchors', () => {
  it('puts one anchor at the summit of a thick blob', () => {
    const [cluster] = findClusters(grid('.....', '.MMM.', '.MMM.', '.MMM.', '.....'));
    const anchors = peakAnchors(cluster, depthField(cluster), 2);
    expect(anchors).toEqual([{ tx: 2, ty: 2 }]);
  });

  it('thins a small blob down to a single ridge', () => {
    // Every tile here is a maximum at depth 1; without separation each would get
    // its own decal and they would all overlap.
    const [cluster] = findClusters(grid('MM', 'MM'));
    expect(peakAnchors(cluster, depthField(cluster), 3)).toHaveLength(1);
  });

  it('spaces anchors along a long ridge instead of one per tile', () => {
    const [cluster] = findClusters(grid('.........', '.MMMMMMM.', '.........'));
    const anchors = peakAnchors(cluster, depthField(cluster), 3);
    expect(anchors.length).toBeGreaterThan(1);
    expect(anchors.length).toBeLessThan(cluster.tiles.length);
    for (const a of anchors) {
      for (const b of anchors) {
        if (a === b) continue;
        expect(Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('is deterministic — peers must decorate the same cluster identically', () => {
    const rows = ['.......', '.MMMMM.', '.MMMMM.', '.MMMMM.', '.......'];
    const run = () => {
      const [cluster] = findClusters(grid(...rows));
      return peakAnchors(cluster, depthField(cluster), 2);
    };
    expect(run()).toEqual(run());
  });
});
