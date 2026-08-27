import { TerrainKind } from '@drone-directive/types/enums';
import type { TerrainGrid } from '../../../engine/obstacles';

/**
 * Terrain geometry: the shapes `TerrainView` draws instead of drawing cells.
 *
 * Everything here is a pure function of the `TerrainGrid`, with no Pixi and no
 * config — it is the part of the renderer that has an answer worth testing. Grid
 * dimensions are read off the array rather than from `gameConfig`, so a test can
 * hand in a 4×4 world.
 *
 * Deliberately kept in `pixi/` rather than `engine/`: the simulation has no use for
 * a silhouette, and the engine layer may not grow render concerns.
 */

export interface Tile {
  tx: number;
  ty: number;
}

/** Inclusive tile bounds. */
export interface Bbox {
  minTx: number;
  minTy: number;
  maxTx: number;
  maxTy: number;
}

/** One connected run of a single terrain kind — the unit the renderer treats as a landform. */
export interface Cluster {
  /** Never `Open`. */
  kind: TerrainKind;
  tiles: Tile[];
  bbox: Bbox;
}

/** Which side of a tile a boundary segment lies on. The four normals the rim shading keys off. */
export type Side = 'n' | 's' | 'e' | 'w';

export interface BoundaryEdge extends Tile {
  side: Side;
}

/** Chebyshev distance from open ground, over one cluster. 1 = boundary tile, higher = deeper inside. */
export interface DepthField {
  bbox: Bbox;
  /** 0 for anything outside the cluster. */
  at(tx: number, ty: number): number;
  max: number;
}

const NEIGHBOURS_4: readonly (readonly [number, number, Side])[] = [
  [0, -1, 'n'],
  [0, 1, 's'],
  [1, 0, 'e'],
  [-1, 0, 'w'],
];

function kindAt(terrain: TerrainGrid, tx: number, ty: number): TerrainKind {
  // Out of bounds counts as open: the map edge is where terrain stops, so a
  // cluster running into it gets a boundary there and its shading falls off
  // rather than looking like it continues past the world.
  const row = terrain[ty];
  if (!row) return TerrainKind.Open;
  return row[tx] ?? TerrainKind.Open;
}

function emptyBbox(tx: number, ty: number): Bbox {
  return { minTx: tx, minTy: ty, maxTx: tx, maxTy: ty };
}

function growBbox(bbox: Bbox, tx: number, ty: number): void {
  if (tx < bbox.minTx) bbox.minTx = tx;
  if (ty < bbox.minTy) bbox.minTy = ty;
  if (tx > bbox.maxTx) bbox.maxTx = tx;
  if (ty > bbox.maxTy) bbox.maxTy = ty;
}

/**
 * Flood-fills the grid into connected clusters, **4-connected and within a single
 * `TerrainKind`**.
 *
 * Both restrictions are load-bearing. A mountain touching a crater must stay two
 * landforms, or one silhouette would be shaded as rising and sinking at once; and
 * 8-connectivity would fuse two blobs that meet at a single corner into a shape
 * whose shadow crosses open ground the units drive through.
 *
 * Iterates in row-major order and pushes tiles in visit order, so the output is
 * deterministic — every peer decorates the same cluster the same way.
 */
export function findClusters(terrain: TerrainGrid): Cluster[] {
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;
  const seen = new Uint8Array(width * height);
  const clusters: Cluster[] = [];

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const kind = kindAt(terrain, tx, ty);
      if (kind === TerrainKind.Open || seen[ty * width + tx]) continue;

      const tiles: Tile[] = [];
      const bbox = emptyBbox(tx, ty);
      const stack: Tile[] = [{ tx, ty }];
      seen[ty * width + tx] = 1;

      while (stack.length) {
        const cur = stack.pop();
        if (!cur) break; // unreachable: guarded by `stack.length`
        tiles.push(cur);
        growBbox(bbox, cur.tx, cur.ty);
        for (const [dx, dy] of NEIGHBOURS_4) {
          const nx = cur.tx + dx;
          const ny = cur.ty + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (seen[ny * width + nx] || kindAt(terrain, nx, ny) !== kind) continue;
          seen[ny * width + nx] = 1;
          stack.push({ tx: nx, ty: ny });
        }
      }

      clusters.push({ kind, tiles, bbox });
    }
  }

  return clusters;
}

/**
 * Every grid edge where a cell of `kind` meets something that isn't — the outline
 * the rim shading is stroked along.
 *
 * Returned per tile-and-side rather than as traced polygons on purpose: the edges
 * are axis-aligned, so the side alone gives the outward normal, and "is this edge
 * facing the light" becomes a lookup instead of geometry. Tracing a polygon would
 * buy a smooth outline that this art style has no use for.
 */
export function boundaryEdges(terrain: TerrainGrid, kind: TerrainKind): BoundaryEdge[] {
  const edges: BoundaryEdge[] = [];
  for (let ty = 0; ty < terrain.length; ty++) {
    const row = terrain[ty];
    for (let tx = 0; tx < row.length; tx++) {
      if (row[tx] !== kind) continue;
      for (const [dx, dy, side] of NEIGHBOURS_4) {
        if (kindAt(terrain, tx + dx, ty + dy) !== kind) edges.push({ tx, ty, side });
      }
    }
  }
  return edges;
}

/**
 * Chebyshev distance transform over one cluster: how far each tile sits from the
 * nearest open ground, counting diagonals.
 *
 * This is the cluster's *thickness*, and it is what the renderer has instead of a
 * heightmap — the fill is flat by design, so the sense of a mass rising toward its
 * middle (or a pit deepening toward its bottom) is drawn from this field. It also
 * decides where ridge decals go, since the deepest interior is where a real massif
 * puts its summits.
 *
 * 8-connected because a tile is only genuinely interior when it is surrounded on
 * all eight sides; a 4-connected transform calls a diagonal staircase "deep" and
 * puts a summit on what is visibly an edge.
 */
export function depthField(cluster: Cluster): DepthField {
  const { bbox } = cluster;
  const w = bbox.maxTx - bbox.minTx + 1;
  const h = bbox.maxTy - bbox.minTy + 1;
  const depth = new Int32Array(w * h);
  const inCluster = new Uint8Array(w * h);
  const idx = (tx: number, ty: number) => (ty - bbox.minTy) * w + (tx - bbox.minTx);

  for (const t of cluster.tiles) inCluster[idx(t.tx, t.ty)] = 1;

  // Seed: any tile with a missing 8-neighbour is on the boundary, at depth 1.
  const queue: Tile[] = [];
  for (const t of cluster.tiles) {
    let boundary = false;
    for (let dy = -1; dy <= 1 && !boundary; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = t.tx + dx;
        const ny = t.ty + dy;
        const outside =
          nx < bbox.minTx || nx > bbox.maxTx || ny < bbox.minTy || ny > bbox.maxTy || !inCluster[idx(nx, ny)];
        if (outside) {
          boundary = true;
          break;
        }
      }
    }
    if (boundary) {
      depth[idx(t.tx, t.ty)] = 1;
      queue.push(t);
    }
  }

  let max = queue.length ? 1 : 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const d = depth[idx(cur.tx, cur.ty)];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.tx + dx;
        const ny = cur.ty + dy;
        if (nx < bbox.minTx || nx > bbox.maxTx || ny < bbox.minTy || ny > bbox.maxTy) continue;
        const i = idx(nx, ny);
        if (!inCluster[i] || depth[i] !== 0) continue;
        depth[i] = d + 1;
        if (d + 1 > max) max = d + 1;
        queue.push({ tx: nx, ty: ny });
      }
    }
  }

  return {
    bbox,
    max,
    at(tx, ty) {
      if (tx < bbox.minTx || tx > bbox.maxTx || ty < bbox.minTy || ty > bbox.maxTy) return 0;
      return depth[idx(tx, ty)];
    },
  };
}

/**
 * Where to put ridge decals: the local maxima of the depth field, thinned so two
 * summits can't land on top of each other.
 *
 * A cluster gets its summits where it is thickest, which is what makes a massif
 * read as a range rather than a dome. `minSeparation` is in tiles and is what keeps
 * a small blob to one ridge — without it a 4-tile cluster, where every tile is a
 * maximum at depth 1, would get four overlapping decals.
 *
 * Sorted deepest-first with a coordinate tie-break, so the greedy thinning (and
 * therefore the result) is identical on every peer.
 */
/**
 * Chebyshev tiles two ridge decals must be apart. Also what keeps a small blob to one.
 *
 * Exported because `critters.ts` has to know it too: a critter is placed by the same
 * "deepest interior" rule that puts a summit there, so without the shared number the
 * two would compete for the same tile and the creature would sit under a rock.
 */
export const PEAK_SEPARATION = 3;

export function peakAnchors(cluster: Cluster, depth: DepthField, minSeparation: number): Tile[] {
  const candidates: Tile[] = [];
  for (const t of cluster.tiles) {
    const d = depth.at(t.tx, t.ty);
    if (d === 0) continue;
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (depth.at(t.tx + dx, t.ty + dy) > d) {
          isMax = false;
          break;
        }
      }
    }
    if (isMax) candidates.push(t);
  }

  candidates.sort((a, b) => {
    const byDepth = depth.at(b.tx, b.ty) - depth.at(a.tx, a.ty);
    if (byDepth !== 0) return byDepth;
    return a.ty - b.ty || a.tx - b.tx;
  });

  const chosen: Tile[] = [];
  for (const c of candidates) {
    const clear = chosen.every((p) => Math.max(Math.abs(p.tx - c.tx), Math.abs(p.ty - c.ty)) >= minSeparation);
    if (clear) chosen.push(c);
  }
  return chosen;
}
