import { gameConfig } from '../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { hasClearance, inBounds, isBlockedGrid, tileCentre, tileOf, type ObstacleGrid } from './obstacles';

const SQRT2 = Math.SQRT2;

export interface Tile {
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
 * Per-search scratch for `findPath`, kept alive between calls.
 *
 * **Typed arrays instead of `Map`, and that is where the time went.** Measured warm
 * over 60 searches on an 80×80 generated map, all three variants expanding exactly
 * the same 72 506 nodes: the original `Map` + linear-scan open list took 136 ms, a
 * heap over the same `Map`s 110 ms, and this 44 ms. The open list was the obvious
 * suspect and the smaller half of the answer — per-node bookkeeping through hashed
 * `Map` lookups was the rest.
 *
 * It exists to stop a match's worst search blowing a frame. One search on the large
 * map cost 7.3 ms while the mean tick was 0.6 ms, which is a stutter no graphics
 * setting can reach, because it is not drawing.
 *
 * **Nothing is cleared between searches.** Wiping six arrays of `width × height`
 * would cost more than most searches do, so every cell carries the `generation` it
 * was last written in and anything stamped older reads as untouched.
 *
 * **Not reentrant**, deliberately: one buffer set, so a second search started inside
 * another would corrupt both. The engine is single-threaded and `findPath` calls
 * nothing that could re-enter it.
 */
class SearchScratch {
  private capacity = 0;
  private g = new Float64Array(0);
  private f = new Float64Array(0);
  private parent = new Int32Array(0);
  /** Index in `heap`, or -1 when the tile is not open. */
  private heapPos = new Int32Array(0);
  /** Order the tile entered the open set — the tie-break between equal `f`. */
  private arrival = new Int32Array(0);
  private stamp = new Int32Array(0);
  private generation = 0;
  private arrivals = 0;
  private readonly heap: number[] = [];

  /** Starts a fresh search over a `size`-tile grid, invalidating everything written before. */
  begin(size: number): void {
    if (this.capacity < size) {
      this.capacity = size;
      this.g = new Float64Array(size);
      this.f = new Float64Array(size);
      this.parent = new Int32Array(size);
      this.heapPos = new Int32Array(size);
      this.arrival = new Int32Array(size);
      this.stamp = new Int32Array(size);
      this.generation = 0;
    }
    // `stamp` holds int32, so the counter cannot run forever without wrapping into a
    // value some cell already carries. Reachable only after 2^31 searches, and one
    // wipe is all it costs to be certain rather than nearly certain.
    if (this.generation === 0x7fffffff) {
      this.stamp.fill(0);
      this.generation = 0;
    }
    this.generation++;
    this.arrivals = 0;
    this.heap.length = 0;
  }

  get size(): number {
    return this.heap.length;
  }

  /** Cost known to reach `node`, or `Infinity` if this search has not reached it. */
  costTo(node: number): number {
    return this.stamp[node] === this.generation ? this.g[node] : Infinity;
  }

  /** The tile `node` was reached from, or -1 for the start tile. */
  parentOf(node: number): number {
    return this.stamp[node] === this.generation ? this.parent[node] : -1;
  }

  /**
   * Records a better route to `node` and puts it in the open set, or re-sifts it if
   * it is already there.
   *
   * The re-sift is the reason the heap is indexed: a tile already open gets its `f`
   * lowered rather than being inserted a second time, and a plain heap would go on
   * ordering it by the key it was pushed with.
   */
  open(node: number, parent: number, cost: number, estimate: number): void {
    const fresh = this.stamp[node] !== this.generation;
    if (fresh) {
      this.stamp[node] = this.generation;
      this.heapPos[node] = -1;
    }
    this.g[node] = cost;
    this.f[node] = estimate;
    this.parent[node] = parent;

    const at = fresh ? -1 : this.heapPos[node];
    if (at >= 0) {
      this.up(at);
      return;
    }
    this.arrival[node] = this.arrivals++;
    this.heap.push(node);
    this.heapPos[node] = this.heap.length - 1;
    this.up(this.heap.length - 1);
  }

  /** Removes and returns the open tile with the lowest `f`, earliest arrival winning ties. */
  pop(): number {
    const top = this.heap[0];
    this.heapPos[top] = -1;
    const last = this.heap[this.heap.length - 1];
    this.heap.length -= 1;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.heapPos[last] = 0;
      this.down(0);
    }
    return top;
  }

  /**
   * The whole ordering rule, in one place: lowest `f` wins, and equal `f` goes to
   * whichever tile entered the open set first.
   *
   * **The tie-break is load-bearing.** `findPath` runs inside the deterministic
   * lockstep pipeline, so two peers must return the same route, not two equally short
   * ones — which of several equally good tiles is expanded first decides the polyline.
   * `pathfinding.equivalence.test.ts` re-implements this rule the slow, obvious way and
   * demands agreement on every input, so a later optimisation cannot quietly reorder it.
   */
  private before(a: number, b: number): boolean {
    return this.f[a] !== this.f[b] ? this.f[a] < this.f[b] : this.arrival[a] < this.arrival[b];
  }

  private swap(i: number, j: number): void {
    const a = this.heap[i];
    const b = this.heap[j];
    this.heap[i] = b;
    this.heap[j] = a;
    this.heapPos[b] = i;
    this.heapPos[a] = j;
  }

  private up(from: number): void {
    let i = from;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(this.heap[i], this.heap[parent])) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private down(from: number): void {
    let i = from;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < this.heap.length && this.before(this.heap[left], this.heap[best])) best = left;
      if (right < this.heap.length && this.before(this.heap[right], this.heap[best])) best = right;
      if (best === i) break;
      this.swap(i, best);
      i = best;
    }
  }
}

/** One set of buffers for the whole process — see `SearchScratch` on why it is shared. */
const scratch = new SearchScratch();

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

  const { width, height } = gameConfig.grid;
  const startI = idx(start.tx, start.ty);
  const goalI = idx(goal.tx, goal.ty);
  scratch.begin(width * height);
  scratch.open(startI, -1, 0, heuristic(start.tx, start.ty, goal.tx, goal.ty));

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

  while (scratch.size) {
    const current = scratch.pop();

    if (current === goalI) {
      const path = reconstruct(current, goal, to, snapped);
      return escape ? [escape, ...path] : path;
    }

    const cx = current % width;
    const cy = Math.floor(current / width);
    const costHere = scratch.costTo(current);
    for (const [dx, dy, cost] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (isBlockedGrid(grid, nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (isBlockedGrid(grid, cx + dx, cy) || isBlockedGrid(grid, cx, cy + dy)) continue;
      }
      const ni = idx(nx, ny);
      const tentative = costHere + cost;
      if (tentative < scratch.costTo(ni)) {
        scratch.open(ni, current, tentative, tentative + heuristic(nx, ny, goal.tx, goal.ty));
      }
    }
  }

  // No route to the goal — but if we were stuck in a blocked cell, at least
  // step out to open ground so the unit can re-path next tick instead of freezing.
  return escape ? [escape] : [];
}

/** Walks the parent chain `scratch` recorded, so it must run before the next `begin`. */
function reconstruct(goalI: number, goal: Tile, to: Vec2, snapped: boolean): Vec2[] {
  const chain: number[] = [];
  let cur = goalI;
  for (let parent = scratch.parentOf(cur); parent >= 0; parent = scratch.parentOf(cur)) {
    chain.push(cur);
    cur = parent;
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
    // Safe: guarded by `queue.length` on the line above. Not an entity-shape
    // assertion — TS simply can't tie `shift()` to the loop condition.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

/**
 * Pulls the slack out of an A* result: a waypoint is dropped whenever a hull of
 * `radius` can drive straight from the last kept point to the one after it.
 *
 * `findPath` walks tile centres, so on a diagonal its output is a staircase that
 * swings half a tile either side of the line the thing driving it actually
 * travels. For a formation frame that is fatal — the frame's origin positions
 * every slot, so a wobbling polyline wobbles the whole lattice, and a nine-strong
 * march across open ground cost 5060 hold/drive flips against 280 once smoothed.
 * For a single robot it is merely constant: every zag is another tile edge to
 * drive into and another chance for the anti-jam retreat to fire.
 *
 * Greedy and one-pass: O(n²) clearance probes on a path of a few dozen points,
 * paid once per search, never per tick. The last point is always kept, so an
 * exact goal stays exact.
 *
 * **Returns the kept waypoints only — no head.** The two callers disagree about
 * that on purpose: `setGoal` feeds the list straight into `movement.path`, whose
 * first entry is the next destination (a head would be the robot's own feet, and
 * a tick spent arriving at them), while `routeFor` prepends its anchor because a
 * *route* is a line to project onto rather than a list to walk.
 */
export function smoothPath(grid: ObstacleGrid, from: Vec2, points: readonly Vec2[], radius: number): Vec2[] {
  if (points.length === 0) return []; // nowhere to go: the caller reads that as "no route"
  const kept: Vec2[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    // The furthest point still reachable in a straight line from where we are;
    // never fewer than one step, so this always terminates.
    let furthest = i;
    for (let j = points.length - 1; j > i; j--) {
      if (hasClearance(grid, anchor, points[j], radius)) {
        furthest = j;
        break;
      }
    }
    kept.push(points[furthest]);
    anchor = points[furthest];
    i = furthest + 1;
  }
  return kept;
}
