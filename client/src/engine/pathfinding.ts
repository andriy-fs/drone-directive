import { gameConfig } from '../config/gameConfig';
import type { Vec2 } from '../types/entities';
import { inBounds, isBlockedGrid, tileCentre, tileOf, type ObstacleGrid } from './obstacles';

const SQRT2 = Math.SQRT2;

interface Tile {
  tx: number;
  ty: number;
}

const idx = (tx: number, ty: number): number => ty * gameConfig.grid.width + tx;

/** Octile heuristic (matches 8-dir movement costs). */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * A* over the tile grid, 8-directional with no corner-cutting. Returns
 * world-space waypoints (excluding the start tile), or `[]` if unreachable. The
 * final waypoint is the exact `to` point unless it had to be snapped out of an
 * obstacle.
 *
 * If the *start* tile is blocked (e.g. a robot shoved inside a base footprint),
 * the route is prefixed with a straight hop to the nearest free tile so the unit
 * can escape instead of freezing — A* can't otherwise leave a blocked cell.
 */
export function findPath(grid: ObstacleGrid, from: Vec2, to: Vec2): Vec2[] {
  let start = tileOf(from);
  let goal = tileOf(to);
  let snapped = false;

  let escape: Vec2 | undefined;
  if (isBlockedGrid(grid, start.tx, start.ty)) {
    start = nearestFreeTile(grid, start.tx, start.ty);
    escape = tileCentre(start.tx, start.ty); // walk out here first
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
    // Pick the open node with the lowest f (linear scan is fine for this grid).
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

  // No route to the goal — but if we were stuck in a blocked cell, at least
  // step out to open ground so the unit can re-path next tick instead of freezing.
  return escape ? [escape] : [];
}

function reconstruct(
  cameFrom: Map<number, number>,
  goalI: number,
  goal: Tile,
  to: Vec2,
  snapped: boolean,
): Vec2[] {
  const chain: number[] = [];
  let cur = goalI;
  while (cameFrom.has(cur)) {
    chain.push(cur);
    cur = cameFrom.get(cur)!;
  }
  chain.reverse(); // first step after start ... goal
  const { width } = gameConfig.grid;
  const points = chain.map((i) => tileCentre(i % width, Math.floor(i / width)));
  if (points.length > 0) {
    points[points.length - 1] = snapped ? tileCentre(goal.tx, goal.ty) : { x: to.x, y: to.y };
  }
  return points;
}

/** Closest passable in-bounds tile to (tx,ty), found by outward BFS. */
export function nearestFreeTile(grid: ObstacleGrid, tx: number, ty: number): Tile {
  if (inBounds(tx, ty) && !grid[ty][tx]) return { tx, ty };
  const seen = new Set<string>([`${tx},${ty}`]);
  const queue: Tile[] = [{ tx, ty }];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (queue.length) {
    const cur = queue.shift()!;
    if (inBounds(cur.tx, cur.ty) && !grid[cur.ty][cur.tx]) return cur;
    for (const [dx, dy] of dirs) {
      const nx = cur.tx + dx;
      const ny = cur.ty + dy;
      const k = `${nx},${ny}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (inBounds(nx, ny)) queue.push({ tx: nx, ty: ny });
    }
  }
  return { tx, ty };
}
