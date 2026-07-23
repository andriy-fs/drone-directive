import { gameConfig } from '../config/gameConfig';
import type { Vec2 } from '../types/entities';
import type { Rng } from '../utils/rng';

/** Blocked-tile grid: `grid[ty][tx]` is true where terrain is impassable. */
export type ObstacleGrid = boolean[][];

const { width, height, tilePx } = gameConfig.grid;

export function tileOf(pos: Vec2): { tx: number; ty: number } {
  return { tx: Math.floor(pos.x / tilePx), ty: Math.floor(pos.y / tilePx) };
}

export function tileCentre(tx: number, ty: number): Vec2 {
  return { x: (tx + 0.5) * tilePx, y: (ty + 0.5) * tilePx };
}

export function inBounds(tx: number, ty: number): boolean {
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
 */
export function generateObstacles(rng: Rng): ObstacleGrid {
  const grid: ObstacleGrid = [];
  for (let y = 0; y < height; y++) grid.push(new Array<boolean>(width).fill(false));

  const protectedCells = computeProtected();

  let placed = 0;
  let attempts = 0;
  const maxAttempts = gameConfig.obstacles.blobCount * 20;
  while (placed < gameConfig.obstacles.blobCount && attempts < maxAttempts) {
    attempts++;
    const tx = rng.int(width);
    const ty = rng.int(height);
    if (protectedCells.has(key(tx, ty)) || grid[ty][tx]) continue;
    stampBlob(grid, protectedCells, tx, ty, rng);
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

/** Random-walk a small cluster of blocked tiles from a seed cell. */
function stampBlob(
  grid: ObstacleGrid,
  protectedCells: Set<string>,
  tx: number,
  ty: number,
  rng: Rng,
): void {
  const size = 1 + rng.int(gameConfig.obstacles.maxBlobTiles);
  let cx = tx;
  let cy = ty;
  for (let i = 0; i < size; i++) {
    if (inBounds(cx, cy) && !protectedCells.has(key(cx, cy))) grid[cy][cx] = true;
    const dir = rng.int(4);
    cx += dir === 0 ? 1 : dir === 1 ? -1 : 0;
    cy += dir === 2 ? 1 : dir === 3 ? -1 : 0;
  }
}

function baseCentre(owner: string): { tx: number; ty: number } {
  const fp = gameConfig.bases.footprintTiles;
  const p =
    gameConfig.bases.placements.find((b) => b.owner === owner) ??
    gameConfig.bases.placements[0];
  return { tx: p.tx + Math.floor(fp / 2), ty: p.ty + Math.floor(fp / 2) };
}

function ensureConnectivity(grid: ObstacleGrid): void {
  const a = baseCentre('player');
  const b = baseCentre('ai');
  if (isReachable(grid, a, b)) return;
  carveCorridor(grid, a, b);
}

/** BFS over free tiles, 8-directional with no corner-cutting (matches A*). */
function isReachable(
  grid: ObstacleGrid,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): boolean {
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
function carveCorridor(
  grid: ObstacleGrid,
  a: { tx: number; ty: number },
  b: { tx: number; ty: number },
): void {
  let x = a.tx;
  let y = a.ty;
  const clear = () => {
    if (inBounds(x, y)) grid[y][x] = false;
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
