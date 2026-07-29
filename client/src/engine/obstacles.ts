import { gameConfig, type BasePlacement } from '../config/gameConfig';
import type { Vec2 } from '../types/entities';
import { TerrainKind } from '../types/enums';
import type { Rng } from '../utils/rng';

/** Blocked-tile grid: `grid[ty][tx]` is true where terrain blocks the queried thing. */
export type ObstacleGrid = boolean[][];

/** Per-tile terrain kind (`grid[ty][tx]`) — the source of truth the two boolean grids derive from. */
export type TerrainGrid = TerrainKind[][];

/** Nothing drives over a mountain or through a crater. */
export function blocksMovement(kind: TerrainKind): boolean {
  return kind !== TerrainKind.Open;
}

/** Only a mountain rises high enough to stop a shot — a crater is a depression, shots cross it. */
export function blocksSight(kind: TerrainKind): boolean {
  return kind === TerrainKind.Mountain;
}

function derive(terrain: TerrainGrid, blocks: (kind: TerrainKind) => boolean): ObstacleGrid {
  return terrain.map((row) => row.map(blocks));
}

/** Impassable tiles — the grid pathfinding and roam-target picking run on. */
export function movementGrid(terrain: TerrainGrid): ObstacleGrid {
  return derive(terrain, blocksMovement);
}

/** Sight/fire-blocking tiles — the grid line-of-sight and projectile collision run on. */
export function sightGrid(terrain: TerrainGrid): ObstacleGrid {
  return derive(terrain, blocksSight);
}

export function tileOf(pos: Vec2): { tx: number; ty: number } {
  const { tilePx } = gameConfig.grid;
  return { tx: Math.floor(pos.x / tilePx), ty: Math.floor(pos.y / tilePx) };
}

export function tileCentre(tx: number, ty: number): Vec2 {
  const { tilePx } = gameConfig.grid;
  return { x: (tx + 0.5) * tilePx, y: (ty + 0.5) * tilePx };
}

export function inBounds(tx: number, ty: number): boolean {
  const { width, height } = gameConfig.grid;
  return tx >= 0 && ty >= 0 && tx < width && ty < height;
}

/** Out-of-bounds counts as blocked so pathing/LOS never leaves the map. */
export function isBlockedGrid(grid: ObstacleGrid, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return true;
  return grid[ty][tx];
}

function key(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

/**
 * Generates random obstacle clusters, keeping a margin around both bases clear,
 * then GUARANTEES a route by verifying base-to-base connectivity and carving an
 * L-shaped corridor if the map came out sealed.
 *
 * The kind is rolled **per cluster**, not per tile, so a blob is all mountain or
 * all crater — mixing them inside one blob reads as noise rather than terrain.
 */
export function generateObstacles(rng: Rng): TerrainGrid {
  const { width, height } = gameConfig.grid;
  const grid: TerrainGrid = [];
  for (let y = 0; y < height; y++) grid.push(new Array<TerrainKind>(width).fill(TerrainKind.Open));

  const protectedCells = computeProtected();

  // `blobCount` is calibrated for the small map; scale by area so a large map
  // gets proportionally more cover rather than the same handful of clusters
  // scattered over four times the ground.
  const reference = gameConfig.mapSize.small ** 2;
  const wanted = Math.round((gameConfig.obstacles.blobCount * width * height) / reference);

  let placed = 0;
  let attempts = 0;
  const maxAttempts = wanted * 20;
  while (placed < wanted && attempts < maxAttempts) {
    attempts++;
    const tx = rng.int(width);
    const ty = rng.int(height);
    if (protectedCells.has(key(tx, ty)) || grid[ty][tx] !== TerrainKind.Open) continue;
    const kind = rng.next() < gameConfig.obstacles.craterChance ? TerrainKind.Crater : TerrainKind.Mountain;
    stampBlob(grid, protectedCells, tx, ty, kind, rng);
    placed++;
  }

  ensureConnectivity(grid);
  return grid;
}

/** Tiles within `baseClearMargin` of any base footprint stay passable. */
function computeProtected(): Set<string> {
  const set = new Set<string>();
  const fp = gameConfig.bases.footprintTiles;
  const margin = gameConfig.obstacles.baseClearMargin;
  for (const p of gameConfig.bases.placements) {
    for (let y = p.ty - margin; y < p.ty + fp + margin; y++) {
      for (let x = p.tx - margin; x < p.tx + fp + margin; x++) {
        if (inBounds(x, y)) set.add(key(x, y));
      }
    }
  }
  return set;
}

/**
 * Random-walks a cluster of one terrain kind from a seed cell, painting a random
 * number of **distinct** tiles in `[minBlobTiles, maxBlobTiles]`. The walk
 * revisits cells, so steps are budgeted rather than looping until the target is
 * met: a blob wedged against the map edge or a base's clear margin can never
 * reach its target, and generation must always terminate.
 */
function stampBlob(
  grid: TerrainGrid,
  protectedCells: Set<string>,
  tx: number,
  ty: number,
  kind: TerrainKind,
  rng: Rng,
): void {
  const { minBlobTiles, maxBlobTiles } = gameConfig.obstacles;
  const target = minBlobTiles + rng.int(maxBlobTiles - minBlobTiles + 1);
  let cx = tx;
  let cy = ty;
  let painted = 0;
  for (let step = 0; step < target * 8 && painted < target; step++) {
    // Only paint open ground: stepping onto another cluster must not repaint it,
    // or blobs would end up with mixed kinds.
    if (inBounds(cx, cy) && !protectedCells.has(key(cx, cy)) && grid[cy][cx] === TerrainKind.Open) {
      grid[cy][cx] = kind;
      painted++;
    }
    const dir = rng.int(4);
    cx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
    cy += dir === 2 ? 1 : dir === 3 ? -1 : 0;
  }
}

function baseCentre(p: BasePlacement): { tx: number; ty: number } {
  const fp = gameConfig.bases.footprintTiles;
  return { tx: p.tx + Math.floor(fp / 2), ty: p.ty + Math.floor(fp / 2) };
}

/**
 * Guarantees every base can drive to every other one: each is checked against
 * the first, carving a corridor where the map came out sealed. Reachability is
 * transitive, so connecting all of them to one hub connects them to each other.
 * Connectivity is about driving, so both terrain kinds count as blocked here.
 */
function ensureConnectivity(terrain: TerrainGrid): void {
  const centres = gameConfig.bases.placements.map(baseCentre);
  const hub = centres[0];
  if (!hub) return;
  for (const centre of centres.slice(1)) {
    // Re-derive the grid each pass: a corridor carved for an earlier base may
    // already have opened the route for this one.
    if (isReachable(movementGrid(terrain), hub, centre)) continue;
    carveCorridor(terrain, hub, centre);
  }
}

/** BFS over free tiles, 8-directional with no corner-cutting (matches A*). */
function isReachable(grid: ObstacleGrid, a: { tx: number; ty: number }, b: { tx: number; ty: number }): boolean {
  const seen = new Set<string>([key(a.tx, a.ty)]);
  const queue: { tx: number; ty: number }[] = [a];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.tx === b.tx && cur.ty === b.ty) return true;
    for (const [dx, dy] of dirs) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      if (isBlockedGrid(grid, nx, ny) || seen.has(key(nx, ny))) continue;
      if (dx !== 0 && dy !== 0) {
        if (isBlockedGrid(grid, cur.tx + dx, cur.ty) || isBlockedGrid(grid, cur.tx, cur.ty + dy)) {
          continue; // no corner cutting
        }
      }
      seen.add(key(nx, ny));
      queue.push({ tx: nx, ty: ny });
    }
  }
  return false;
}

/** Clears an orthogonal L-shaped corridor (x then y) — guarantees a path. */
function carveCorridor(grid: TerrainGrid, a: { tx: number; ty: number }, b: { tx: number; ty: number }): void {
  let x = a.tx;
  let y = a.ty;
  const clear = () => {
    if (inBounds(x, y)) grid[y][x] = TerrainKind.Open;
  };
  clear();
  while (x !== b.tx || y !== b.ty) {
    if (x !== b.tx) x += x < b.tx ? 1 : -1;
    else y += y < b.ty ? 1 : -1;
    clear();
  }
}

/**
 * A copy of the terrain grid with each base footprint stamped as blocked — the
 * navigation grid robots pathfind on (a living base is impassable). Kept
 * separate from the render/LOS terrain grid so destroying a base doesn't reveal
 * rock where it stood; see `navGrid.refreshNavObstacles`.
 */
export function withBaseFootprints(
  terrain: ObstacleGrid,
  bases: { position: Vec2; footprint: number }[],
): ObstacleGrid {
  const { tilePx } = gameConfig.grid;
  const grid = terrain.map((row) => row.slice());
  for (const b of bases) {
    const fp = b.footprint;
    const startTx = Math.round(b.position.x / tilePx - fp / 2);
    const startTy = Math.round(b.position.y / tilePx - fp / 2);
    for (let ty = startTy; ty < startTy + fp; ty++) {
      for (let tx = startTx; tx < startTx + fp; tx++) {
        if (inBounds(tx, ty)) grid[ty][tx] = true;
      }
    }
  }
  return grid;
}

/** True if the straight segment from `from` to `to` crosses no blocked tile. */
export function hasLineOfSight(grid: ObstacleGrid, from: Vec2, to: Vec2): boolean {
  const a = tileOf(from);
  const b = tileOf(to);
  let x0 = a.tx;
  let y0 = a.ty;
  const dx = Math.abs(b.tx - x0);
  const dy = Math.abs(b.ty - y0);
  const sx = x0 < b.tx ? 1 : -1;
  const sy = y0 < b.ty ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (isBlockedGrid(grid, x0, y0)) return false;
    if (x0 === b.tx && y0 === b.ty) return true;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}
