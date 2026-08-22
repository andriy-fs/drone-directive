import { gameConfig } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { inBounds, isBlockedGrid, tileCentre, tileOf, type ObstacleGrid } from '../../obstacles';

/**
 * Flow-field navigation, built for the investigation in
 * `.docs/investigation/flow-field-vs-astar-at-density.md`. **Temporary** — delete
 * with the harness that drives it.
 *
 * One Dijkstra integration outward from the goal tile fills "cost to reach the
 * goal from here" for every tile; a unit then descends that field from wherever
 * it stands. Fields are cached per goal *tile* and thrown away wholesale when the
 * obstacle grid is rebuilt, which is exactly the invalidation model
 * `.docs/rejected-by-metrics/flow-field-navigation.md` describes.
 *
 * Deterministic by construction: integer grid, fixed neighbour order, and a heap
 * that breaks cost ties on tile index, so two peers flood identically. Nothing
 * here reads a clock, a frame time, or `Math.random`.
 */

const SQRT2 = Math.SQRT2;

/** Fixed neighbour order — the tie-break for descent, so it must never be sorted. */
const DIRS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export interface FlowField {
  goalTx: number;
  goalTy: number;
  width: number;
  height: number;
  /** Cost to reach the goal from each tile; `Infinity` where blocked or unreachable. */
  cost: Float64Array;
}

/** What the field cost, so the comparison can quote it instead of assuming it. */
export interface FieldStats {
  builds: number;
  hits: number;
  cellsFlooded: number;
  cellsSettled: number;
  invalidations: number;
  distinctGoals: number;
  descentSteps: number;
}

function blankStats(): FieldStats {
  return { builds: 0, hits: 0, cellsFlooded: 0, cellsSettled: 0, invalidations: 0, distinctGoals: 0, descentSteps: 0 };
}

let stats = blankStats();
export const fieldStats = (): FieldStats => stats;
export const resetFieldStats = (): void => {
  stats = blankStats();
};

// Cache keyed by goal tile, valid only for the grid it was flooded over. The grid
// is compared by identity on purpose: `refreshNavObstacles` builds a fresh array
// when a base dies, and at that tick every field is garbage.
let cacheGrid: ObstacleGrid | undefined;
let cache = new Map<number, FlowField>();
const everSeen = new Set<number>();

export function resetFieldCache(): void {
  cacheGrid = undefined;
  cache = new Map();
  everSeen.clear();
}

const idx = (tx: number, ty: number): number => ty * gameConfig.grid.width + tx;

/**
 * Closest passable tile to (tx,ty), by outward BFS — a copy of `pathfinding`'s,
 * deliberately not imported. The harness swaps `findPath` out with a module mock,
 * and importing anything from that module here would make this file part of the
 * cycle the mock factory is in the middle of resolving.
 */
function nearestFreeTile(grid: ObstacleGrid, tx: number, ty: number): { tx: number; ty: number } {
  if (inBounds(tx, ty) && !grid[ty][tx]) return { tx, ty };
  const seen = new Set<string>([`${tx},${ty}`]);
  const queue: { tx: number; ty: number }[] = [{ tx, ty }];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (inBounds(cur.tx, cur.ty) && !grid[cur.ty][cur.tx]) return cur;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
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

/**
 * Dijkstra outward from `goal`. A binary heap ordered on cost, ties broken by
 * tile index so the settle order — and therefore the field — is identical on
 * every machine.
 */
function integrate(grid: ObstacleGrid, goalTx: number, goalTy: number): FlowField {
  const { width, height } = gameConfig.grid;
  const cost = new Float64Array(width * height).fill(Infinity);
  const settled = new Uint8Array(width * height);

  // Binary heap of tile indices, compared on (cost, index).
  const heap: number[] = [];
  const less = (a: number, b: number): boolean => (cost[a] !== cost[b] ? cost[a] < cost[b] : a < b);
  const push = (v: number): void => {
    heap.push(v);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0 && last !== undefined) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let best = i;
        if (l < heap.length && less(heap[l], heap[best])) best = l;
        if (r < heap.length && less(heap[r], heap[best])) best = r;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return top;
  };

  const goalI = idx(goalTx, goalTy);
  cost[goalI] = 0;
  push(goalI);
  let flooded = 0;
  let settledCount = 0;

  while (heap.length > 0) {
    const cur = pop();
    if (settled[cur]) continue;
    settled[cur] = 1;
    settledCount++;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      if (isBlockedGrid(grid, nx, ny)) continue;
      // Same no-corner-cutting rule A* uses, or the field threads gaps a hull
      // cannot physically drive through and the comparison stops being fair.
      if (dx !== 0 && dy !== 0 && (isBlockedGrid(grid, cx + dx, cy) || isBlockedGrid(grid, cx, cy + dy))) continue;
      const ni = idx(nx, ny);
      if (settled[ni]) continue;
      const next = cost[cur] + step;
      flooded++;
      if (next < cost[ni]) {
        cost[ni] = next;
        push(ni);
      }
    }
  }

  stats.builds++;
  stats.cellsFlooded += flooded;
  stats.cellsSettled += settledCount;
  return { goalTx, goalTy, width, height, cost };
}

/** The cached field for this goal tile over this grid, flooding it if needed. */
export function fieldFor(grid: ObstacleGrid, goalTx: number, goalTy: number): FlowField {
  if (cacheGrid !== grid) {
    if (cacheGrid !== undefined) stats.invalidations++;
    cacheGrid = grid;
    cache = new Map();
  }
  const key = idx(goalTx, goalTy);
  const hit = cache.get(key);
  if (hit) {
    stats.hits++;
    return hit;
  }
  if (!everSeen.has(key)) {
    everSeen.add(key);
    stats.distinctGoals++;
  }
  const built = integrate(grid, goalTx, goalTy);
  cache.set(key, built);
  return built;
}

/**
 * Descends the field from `from` to `to`, returning world-space waypoints in the
 * same contract `findPath` promises: tile centres excluding the start, `[]` when
 * unreachable, the exact `to` as the final point unless it had to be snapped out
 * of an obstacle, and a leading hop to open ground when the unit is standing
 * inside rock.
 *
 * The escape hop is not optional. A field has no value at all in a blocked tile,
 * so a unit shoved inside a base footprint reads `Infinity` under its own feet
 * and would descend nowhere — the permanent freeze the rejection warned about.
 */
export function findPathViaField(grid: ObstacleGrid, from: Vec2, to: Vec2): Vec2[] {
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

  const field = fieldFor(grid, goal.tx, goal.ty);
  const { width } = field;
  if (!Number.isFinite(field.cost[idx(start.tx, start.ty)])) return escape ? [escape] : [];

  // Steepest descent. Dijkstra leaves no local minimum, so cost strictly drops
  // every step and this cannot loop; the cap is belt-and-braces against a field
  // built over a grid that changed underneath us.
  const points: Vec2[] = [];
  let cx = start.tx;
  let cy = start.ty;
  let reached = false;
  const cap = width * field.height;
  for (let guard = 0; guard < cap; guard++) {
    if (cx === goal.tx && cy === goal.ty) {
      reached = true;
      break;
    }
    let bestX = -1;
    let bestY = -1;
    let bestCost = field.cost[idx(cx, cy)];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(nx, ny)) continue;
      if (isBlockedGrid(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (isBlockedGrid(grid, cx + dx, cy) || isBlockedGrid(grid, cx, cy + dy))) continue;
      const c = field.cost[idx(nx, ny)];
      // Strict `<` with the fixed `DIRS` order as the tie-break: two neighbours
      // of equal cost must always resolve the same way on both peers.
      if (c < bestCost) {
        bestCost = c;
        bestX = nx;
        bestY = ny;
      }
    }
    if (bestX < 0) break; // nowhere cheaper to stand: the descent is done
    cx = bestX;
    cy = bestY;
    points.push(tileCentre(cx, cy));
    stats.descentSteps++;
  }

  // A descent that stopped short never earns the exact goal point — overwriting
  // the last tile centre with `to` would fake an arrival the field never made.
  if (points.length === 0 || !reached) return escape ? [escape, ...points] : points;
  points[points.length - 1] = snapped ? tileCentre(goal.tx, goal.ty) : { x: to.x, y: to.y };
  return escape ? [escape, ...points] : points;
}
