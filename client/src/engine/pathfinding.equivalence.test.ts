import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { createRng } from '../utils/rng';
import { generateObstacles, movementGrid, inBounds, isBlockedGrid, tileCentre, type ObstacleGrid } from './obstacles';
import { findPath, nearestFreeTile } from './pathfinding';

/**
 * `findPath` runs inside the deterministic lockstep pipeline, so two peers must get
 * **the same route**, not merely an equally short one. That makes the search's
 * node-selection order load-bearing: change which of two equally good tiles is
 * expanded first and the returned polyline changes, and the match diverges.
 *
 * The rule the search must implement is: **expand the open tile with the lowest
 * current `f`; break ties in favour of the one that entered the open set first.**
 *
 * This file pins that rule with an oracle. `referencePath` below implements it the
 * slow, obvious way — a linear scan of the open list, re-reading `f` on every pass,
 * which is exactly what `findPath` did before it was given a heap. The real
 * implementation is free to be as clever as it likes as long as it agrees with this
 * one on every input, so a future optimisation cannot quietly reorder expansion.
 *
 * Deliberately a *duplicate* of the old algorithm rather than a shared helper: an
 * oracle that imports the thing it checks proves nothing.
 */

const SQRT2 = Math.SQRT2;
const idx = (tx: number, ty: number): number => ty * gameConfig.grid.width + tx;

function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

function reconstruct(cameFrom: Map<number, number>, goalI: number, goal: Tile, to: Vec2, snapped: boolean): Vec2[] {
  const chain: number[] = [];
  let cur = goalI;
  while (cameFrom.has(cur)) {
    chain.push(cur);
    cur = cameFrom.get(cur) ?? cur;
  }
  chain.reverse();
  const { width } = gameConfig.grid;
  const points = chain.map((i) => tileCentre(i % width, Math.floor(i / width)));
  if (points.length > 0) {
    points[points.length - 1] = snapped ? tileCentre(goal.tx, goal.ty) : { x: to.x, y: to.y };
  }
  return points;
}

interface Tile {
  tx: number;
  ty: number;
}

/** The oracle: A* whose open set is a linear scan re-reading `f` on every pop. */
function referencePath(grid: ObstacleGrid, from: Vec2, to: Vec2): Vec2[] {
  const { tilePx } = gameConfig.grid;
  const tileOf = (p: Vec2): Tile => ({ tx: Math.floor(p.x / tilePx), ty: Math.floor(p.y / tilePx) });
  let start = tileOf(from);
  let goal = tileOf(to);
  let snapped = false;

  let escape: Vec2 | undefined;
  if (isBlockedGrid(grid, start.tx, start.ty)) {
    start = nearestFreeTile(grid, start.tx, start.ty);
    escape = tileCentre(start.tx, start.ty);
  }
  if (isBlockedGrid(grid, goal.tx, goal.ty)) {
    goal = nearestFreeTile(grid, goal.tx, goal.ty);
    snapped = true;
  }
  if (start.tx === goal.tx && start.ty === goal.ty) {
    const end = snapped ? tileCentre(goal.tx, goal.ty) : { x: to.x, y: to.y };
    return escape ? [escape, end] : [end];
  }

  const startI = idx(start.tx, start.ty);
  const goalI = idx(goal.tx, goal.ty);
  const gScore = new Map<number, number>([[startI, 0]]);
  const fScore = new Map<number, number>([[startI, heuristic(start.tx, start.ty, goal.tx, goal.ty)]]);
  const cameFrom = new Map<number, number>();
  const open: number[] = [startI];
  const inOpen = new Set<number>([startI]);

  const dirs: [number, number, number][] = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ];

  while (open.length) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if ((fScore.get(open[i]) ?? Infinity) < (fScore.get(open[bestIdx]) ?? Infinity)) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    inOpen.delete(current);

    if (current === goalI) {
      const path = reconstruct(cameFrom, current, goal, to, snapped);
      return escape ? [escape, ...path] : path;
    }

    const cx = current % gameConfig.grid.width;
    const cy = Math.floor(current / gameConfig.grid.width);
    for (const [dx, dy, cost] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlockedGrid(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (isBlockedGrid(grid, cx + dx, cy) || isBlockedGrid(grid, cx, cy + dy)) continue;
      }
      const ni = idx(nx, ny);
      const tentative = (gScore.get(current) ?? Infinity) + cost;
      if (tentative < (gScore.get(ni) ?? Infinity)) {
        cameFrom.set(ni, current);
        gScore.set(ni, tentative);
        fScore.set(ni, tentative + heuristic(nx, ny, goal.tx, goal.ty));
        if (!inOpen.has(ni)) {
          open.push(ni);
          inOpen.add(ni);
        }
      }
    }
  }
  return escape ? [escape] : [];
}

function openGrid(): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  return Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

/** Scattered single-tile rock: the case with the most ties, since costs collide constantly. */
function speckledGrid(seed: number, density: number): ObstacleGrid {
  const rng = createRng(seed);
  const g = openGrid();
  const { width, height } = gameConfig.grid;
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) g[ty][tx] = rng.next() < density;
  }
  return g;
}

/** A grid sealed off down the middle, so the search has to exhaust one side and fail. */
function walledGrid(): ObstacleGrid {
  const g = openGrid();
  const { width, height } = gameConfig.grid;
  const mid = Math.floor(width / 2);
  for (let ty = 0; ty < height; ty++) g[ty][mid] = true;
  return g;
}

function point(tx: number, ty: number): Vec2 {
  return tileCentre(tx, ty);
}

describe('findPath agrees with the linear-scan oracle', () => {
  const { width, height, tilePx } = gameConfig.grid;

  const grids: [string, ObstacleGrid][] = [
    ['open ground', openGrid()],
    ['light speckle', speckledGrid(11, 0.08)],
    ['heavy speckle', speckledGrid(12, 0.25)],
    ['generated terrain', movementGrid(generateObstacles(createRng(7)))],
    ['sealed in half', walledGrid()],
  ];

  for (const [name, grid] of grids) {
    it(`matches on ${name}`, () => {
      const rng = createRng(99);
      let compared = 0;
      for (let i = 0; i < 120; i++) {
        const from = point(Math.floor(rng.next() * width), Math.floor(rng.next() * height));
        const to = point(Math.floor(rng.next() * width), Math.floor(rng.next() * height));
        expect(findPath(grid, from, to)).toEqual(referencePath(grid, from, to));
        compared++;
      }
      expect(compared).toBe(120);
    });
  }

  it('matches on the long diagonal, the worst case the search ever runs', () => {
    const grid = movementGrid(generateObstacles(createRng(7)));
    const from = point(1, 1);
    const to = point(width - 2, height - 2);
    expect(findPath(grid, from, to)).toEqual(referencePath(grid, from, to));
  });

  it('matches when the goal is unreachable', () => {
    const grid = walledGrid();
    const mid = Math.floor(width / 2);
    expect(findPath(grid, point(1, 1), point(mid + 3, height - 2))).toEqual(
      referencePath(grid, point(1, 1), point(mid + 3, height - 2)),
    );
  });

  it('matches when start and goal are both buried in rock', () => {
    const grid = openGrid();
    for (let ty = 2; ty <= 6; ty++) for (let tx = 2; tx <= 6; tx++) grid[ty][tx] = true;
    for (let ty = 20; ty <= 24; ty++) for (let tx = 20; tx <= 24; tx++) grid[ty][tx] = true;
    const from = { x: 4 * tilePx + 5, y: 4 * tilePx + 5 };
    const to = { x: 22 * tilePx + 5, y: 22 * tilePx + 5 };
    expect(findPath(grid, from, to)).toEqual(referencePath(grid, from, to));
    expect(inBounds(0, 0)).toBe(true);
  });
});
