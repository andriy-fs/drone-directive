import { gameConfig, type BasePlacement } from '../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { TerrainKind } from '@drone-directive/types/enums';
import { vecLength } from '../utils/math';
import type { Rng } from '../utils/rng';

/** A grid cell, in tiles. Local to generation — the renderer has its own in `pixi/render/terrain/clusters.ts`. */
interface Tile {
  tx: number;
  ty: number;
}

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
 * then hands the result to `makeDrivable`, which owes the units two guarantees:
 * no drivable ground narrower than `minCorridorTiles`, and a route from every
 * base to every other.
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
  // Where the previous ridge petered out, so the next one can be laid against it —
  // see `chainChance`.
  let previous: Tile | null = null;
  let previousKind: TerrainKind | null = null;
  // How many ridges are already stacked on the current massif, against `chainMax`.
  let chained = 0;
  // The tour of coarse regions free seeds are dealt from, and how many have been dealt.
  const tour = regionTour(rng);
  let free = 0;
  while (placed < wanted && attempts < maxAttempts) {
    attempts++;
    // A chained seed usually lands *on* the ridge it was measured from, which is
    // already painted — so an unusable one falls back to a free placement in the same
    // attempt rather than burning it. Resetting the link instead (the first version of
    // this) meant chaining almost never fired at all.
    const usable = (t: Tile): boolean =>
      inBounds(t.tx, t.ty) && !protectedCells.has(key(t.tx, t.ty)) && grid[t.ty][t.tx] === TerrainKind.Open;
    const near = chained < gameConfig.obstacles.chainMax ? chainedSeed(previous, rng) : null;
    const linked = near !== null && usable(near);
    // A free seed comes out of the next region on the tour, not out of the whole map:
    // uniform draws left a quarter of the battlefield bare on most seeds, and a base
    // could face a wholly open approach. Only the *start* is constrained — the walk
    // and the chain leave the region freely.
    const seed = linked && near ? near : regionSeed(tour[free % tour.length], usable, rng);
    if (!linked) free++;
    if (!usable(seed)) continue;
    chained = linked ? chained + 1 : 0;
    const { tx, ty } = seed;
    // **A chained ridge inherits its neighbour's kind.** Rolling afresh would fuse a
    // mountain onto a crater, and the rule that a blob is all one kind exists because
    // the alternative reads as noise rather than as terrain — a massif that is half
    // rock and half pit is exactly that, at massif scale. So the roll happens only
    // where a new range starts.
    // Annotated because it is not inferrable: narrowing `previousKind` here would need
    // the type of the assignment below, which is this very expression.
    const kind: TerrainKind = linked && previousKind !== null ? previousKind : roll(rng);
    previous = stampBlob(grid, protectedCells, tx, ty, kind, rng);
    previousKind = kind;
    placed++;
  }

  ensureBaseCover(grid, protectedCells, rng);
  makeDrivable(grid, protectedCells);
  return grid;
}

/** One coarse region of the map, in tiles — half-open on the far edge. */
interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The map cut into coarse regions, in a shuffled order — the tour free seeds are
 * dealt from, one region each, round-robin.
 *
 * **Why the seeds are dealt rather than drawn.** Uniform placement is uniform only
 * in the limit, and 22 blobs is not the limit: measured over 30 seeds, 14 small maps
 * and 27 medium ones left a region that *could* hold terrain — base margins
 * discounted — holding none at all, which the player reads as every massif being on
 * one side of the battlefield. A tour makes every region take its turn before any
 * region takes a second, which is the property "the map has cover everywhere"
 * actually needs. With it, none of the 30 does.
 *
 * Shuffled rather than walked in order, because the tour is also the order the
 * *kinds* and the chains fall in — a fixed sweep would march a range across the map
 * left to right on every match.
 */
function regionTour(rng: Rng): Region[] {
  const { width, height } = gameConfig.grid;
  const n = Math.max(2, Math.round(width / gameConfig.obstacles.seedRegionTiles));
  const regions: Region[] = [];
  for (let ry = 0; ry < n; ry++) {
    for (let rx = 0; rx < n; rx++) {
      regions.push({
        x0: Math.floor((rx * width) / n),
        y0: Math.floor((ry * height) / n),
        x1: Math.floor(((rx + 1) * width) / n),
        y1: Math.floor(((ry + 1) * height) / n),
      });
    }
  }
  // Fisher–Yates on the passed rng: `Rng` has no shuffle, and using anything else
  // here would desync the two peers of a lockstep match.
  for (let i = regions.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [regions[i], regions[j]] = [regions[j], regions[i]];
  }
  return regions;
}

/** How many tiles a region is probed for a free cell before the whole map is tried. */
const REGION_TRIES = 8;

/**
 * A seed inside `region`, or anywhere on the map if the region has no room left.
 *
 * The fallback matters more than it looks: a region can be entirely base margin or
 * entirely painted, and the placement loop is bounded by `maxAttempts` — a region
 * that can never yield would otherwise eat the budget and thin the whole map out.
 */
function regionSeed(region: Region, usable: (t: Tile) => boolean, rng: Rng): Tile {
  const { width, height } = gameConfig.grid;
  for (let i = 0; i < REGION_TRIES; i++) {
    const t = {
      tx: region.x0 + rng.int(Math.max(1, region.x1 - region.x0)),
      ty: region.y0 + rng.int(Math.max(1, region.y1 - region.y0)),
    };
    if (usable(t)) return t;
  }
  return { tx: rng.int(width), ty: rng.int(height) };
}

/**
 * Tops up the cover on every base's approach, so no side has to cross open ground
 * while its opponent has ridges to hide behind.
 *
 * **A fairness rule before a scenery one.** The random pass left roughly one base in
 * seven on the small map, and one in four on the medium, with nothing to fight around
 * within a fair walk of its own gate. That is not a map that reads badly, it is a map
 * that plays differently for the two sides.
 *
 * The ring starts *outside* `baseClearMargin`, so nothing lands in the spawn ring,
 * and this runs **before** `makeDrivable` — stone added here has to pass the same
 * corridor-width and connectivity guarantees as stone that came from the main pass.
 */
function ensureBaseCover(grid: TerrainGrid, protectedCells: Set<string>, rng: Rng): void {
  const { baseClearMargin, baseCover } = gameConfig.obstacles;
  const usable = (t: Tile): boolean =>
    inBounds(t.tx, t.ty) && !protectedCells.has(key(t.tx, t.ty)) && grid[t.ty][t.tx] === TerrainKind.Open;

  for (const placement of gameConfig.bases.placements) {
    const { tx: cx, ty: cy } = baseCentre(placement);
    // The ring, collected once: it is the same set every attempt, and a base in a
    // corner has most of it off the map.
    const ring: Tile[] = [];
    for (let ty = cy - baseCover.radius; ty <= cy + baseCover.radius; ty++) {
      for (let tx = cx - baseCover.radius; tx <= cx + baseCover.radius; tx++) {
        const d = Math.max(Math.abs(tx - cx), Math.abs(ty - cy));
        if (d <= baseClearMargin || !inBounds(tx, ty)) continue;
        ring.push({ tx, ty });
      }
    }
    if (!ring.length) continue;

    const covered = (): number => ring.reduce((n, t) => n + (grid[t.ty][t.tx] === TerrainKind.Open ? 0 : 1), 0);
    for (let attempt = 0; attempt < baseCover.attempts && covered() < baseCover.tiles; attempt++) {
      const seed = rng.pick(ring);
      if (!usable(seed)) continue;
      stampBlob(grid, protectedCells, seed.tx, seed.ty, roll(rng), rng);
    }
  }
}

/**
 * Enforces the two things a generated map owes the units driving on it: **no
 * drivable ground narrower than `minCorridorTiles`**, and a route from every base
 * to every other.
 *
 * The order matters and so does the loop. Sealing can cut a route (that is the
 * price of filling a neck rather than widening it), and carving one can leave a
 * fresh pinch where the new corridor meets old rock — so the two run alternately
 * until sealing has nothing left to do and every base is still connected. Both
 * steps are monotone in opposite directions, but each pass either fills at least
 * one tile or carves at least one corridor, and the carve makes the map strictly
 * more connected, so the bound is a formality rather than a guard against a real
 * loop.
 */
function makeDrivable(terrain: TerrainGrid, protectedCells: Set<string>): void {
  for (let pass = 0; pass < 4; pass++) {
    sealNarrowGround(terrain, protectedCells);
    if (basesConnected(terrain)) return;
    ensureConnectivity(terrain);
  }
  sealNarrowGround(terrain, protectedCells);
}

/**
 * Fills in every scrap of drivable ground too narrow to march a group through,
 * until none is left.
 *
 * **The rule:** a free tile has to be covered by some fully-free 3×3 block. That
 * one sentence rules out a one- or two-tile corridor, a one-tile alcove, and the
 * diagonal squeeze that is a clean line of sight and an impassable route (see
 * hasClearance`) — it is the morphological opening of the free space, and 3 tiles
 * is 96 px against the ~94 px a six-strong `Box` needs, so the terrain ladder in
 * `systems/task/formation.ts` is never forced into single file by generated
 * ground.
 *
 * **Filled, not widened.** Both settle the same question; filling keeps the
 * mountains massive and the cover density where it was tuned, where widening
 * would sand every blob down and open the map out. The price is that a neck can
 * be the only way through, which is what `makeDrivable` alternates with.
 *
 * Iterated to a fixpoint because filling a neck merges the two blobs either side
 * of it, which can pinch a new one against a third. Monotone — only ever adds
 * rock to a finite grid — so it terminates.
 *
 * No RNG, deliberately: this runs inside `generateObstacles`, and a networked
 * match has both peers build the map from the same seed. A pass that drew from
 * the stream would have to draw identically; one that never touches it cannot get
 * that wrong.
 */
function sealNarrowGround(terrain: TerrainGrid, protectedCells: Set<string>): void {
  const { width, height } = gameConfig.grid;
  for (;;) {
    const grid = movementGrid(terrain);
    const narrow: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (grid[ty][tx] || protectedCells.has(key(tx, ty))) continue;
        if (!inWideGround(grid, tx, ty)) narrow.push({ tx, ty });
      }
    }
    if (narrow.length === 0) return;
    // Every tile of this pass is judged against the *same* grid, so the result
    // does not depend on the order they are visited in.
    for (const { tx, ty } of narrow) terrain[ty][tx] = fillKindAt(terrain, tx, ty);
  }
}

/** Is `tx,ty` inside some fully-free `minCorridorTiles` square? */
function inWideGround(grid: ObstacleGrid, tx: number, ty: number): boolean {
  const span = gameConfig.obstacles.minCorridorTiles;
  for (let oy = -(span - 1); oy <= 0; oy++) {
    for (let ox = -(span - 1); ox <= 0; ox++) {
      let clear = true;
      for (let dy = 0; dy < span && clear; dy++) {
        for (let dx = 0; dx < span && clear; dx++) {
          if (isBlockedGrid(grid, tx + ox + dx, ty + oy + dy)) clear = false;
        }
      }
      if (clear) return true;
    }
  }
  return false;
}

/**
 * What a sealed tile becomes: whichever kind most of the rock around it already
 * is, mountain on a tie or with nothing but map edge for company.
 *
 * A neck belongs to the blob it closes, and `stampBlob` rolls the kind per
 * cluster precisely so a blob reads as one piece of terrain — dropping a crater
 * tile into the throat of a mountain would put back the noise that rule exists to
 * keep out. The tie-break is fixed rather than random for the same reason
 * `sealNarrowGround` takes no RNG.
 */
function fillKindAt(terrain: TerrainGrid, tx: number, ty: number): TerrainKind {
  let mountains = 0;
  let craters = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const kind = inBounds(tx + dx, ty + dy) ? terrain[ty + dy][tx + dx] : TerrainKind.Open;
      if (kind === TerrainKind.Mountain) mountains++;
      else if (kind === TerrainKind.Crater) craters++;
    }
  }
  return craters > mountains ? TerrainKind.Crater : TerrainKind.Mountain;
}

/** Can every base still drive to the first one? */
function basesConnected(terrain: TerrainGrid): boolean {
  const centres = gameConfig.bases.placements.map(baseCentre);
  const hub = centres[0];
  if (!hub) return true;
  const grid = movementGrid(terrain);
  return centres.slice(1).every((centre) => isReachable(grid, hub, centre));
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

/** Mountain or crater, per `craterChance` — the roll that opens a new range. */
function roll(rng: Rng): TerrainKind {
  return rng.next() < gameConfig.obstacles.craterChance ? TerrainKind.Crater : TerrainKind.Mountain;
}

/**
 * Where the next ridge starts when it is being laid against the previous one, or
 * `null` when it should be placed freely.
 *
 * **This is what turns scattered lumps into a range.** Seeding every blob uniformly
 * gives a field of separate blobs of four to sixteen tiles, which is exactly what it
 * looks like: a collection of samples on a floor. Landing roughly half of them within
 * a few tiles of the last one lets neighbours touch and merge — and `sealNarrowGround`
 * then fills the necks between the near misses, so what the player walks around is a
 * handful of massifs with bays and spurs rather than a scatter of pebbles.
 *
 * The offset is deliberately loose: close enough to join or nearly join, far enough
 * that the result is a ridge rather than one fat blob.
 */
function chainedSeed(previous: Tile | null, rng: Rng): Tile | null {
  if (!previous || rng.next() >= gameConfig.obstacles.chainChance) return null;
  const spread = gameConfig.obstacles.chainSpread;
  const span = spread * 2 + 1;
  return { tx: previous.tx + rng.int(span) - spread, ty: previous.ty + rng.int(span) - spread };
}

/**
 * Random-walks a cluster of one terrain kind from a seed cell, painting a random
 * number of **distinct** tiles in `[minBlobTiles, maxBlobTiles]`, and returns where
 * the walk ended so the next blob can be chained onto it.
 *
 * The walk revisits cells, so steps are budgeted rather than looping until the target
 * is met: a blob wedged against the map edge or a base's clear margin can never reach
 * its target, and generation must always terminate.
 *
 * **The walk is biased along one axis** (`ridgeBias`), which is what makes a blob a
 * ridge instead of a lump. An unbiased four-way walk is isotropic — it has no reason
 * to go anywhere — so it piles up around its seed and comes out round. Committing to
 * an axis, and mostly to one direction along it, draws something with a length and a
 * grain, which is what a mountain range is made of. The tile budget does not change,
 * so cover density does not either.
 */
function stampBlob(
  grid: TerrainGrid,
  protectedCells: Set<string>,
  tx: number,
  ty: number,
  kind: TerrainKind,
  rng: Rng,
): Tile {
  const { minBlobTiles, maxBlobTiles, ridgeBias, ridgeWidth } = gameConfig.obstacles;
  const target = minBlobTiles + rng.int(maxBlobTiles - minBlobTiles + 1);
  // The grain of this ridge: an axis, and a direction along it that the walk favours.
  const vertical = rng.int(2) === 0;
  const forward = rng.int(2) === 0 ? 1 : -1;
  let cx = tx;
  let cy = ty;
  let painted = 0;
  // Only paint open ground: stepping onto another cluster must not repaint it, or
  // blobs would end up with mixed kinds.
  const paint = (x: number, y: number): void => {
    if (!inBounds(x, y) || protectedCells.has(key(x, y)) || grid[y][x] !== TerrainKind.Open) return;
    grid[y][x] = kind;
    painted++;
  };

  for (let step = 0; step < target * 8 && painted < target; step++) {
    paint(cx, cy);
    // A one-cell-wide walk draws a snake, and a snake has no inside: measured over 20
    // maps, more than half of all mountain clusters came out a single tile thick, so
    // the depth shading had nothing to shade and a cliff face swallowed the whole
    // mass. Widening the trail across the grain is what gives a ridge a body — the
    // budget is unchanged, so this trades length for mass rather than adding cover.
    if (painted < target && rng.next() < ridgeWidth) {
      const side = rng.int(2) === 0 ? 1 : -1;
      if (vertical) paint(cx + side, cy);
      else paint(cx, cy + side);
    }
    const roll = rng.next();
    // Along the grain most of the time, and mostly forward; across it otherwise, which
    // is what gives the ridge width and keeps it from being a one-tile line.
    const along = roll < ridgeBias;
    const delta = along ? (roll < ridgeBias * 0.75 ? forward : -forward) : rng.int(2) === 0 ? 1 : -1;
    if (along === vertical) cy += delta;
    else cx += delta;
  }
  return { tx: cx, ty: cy };
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
    // Safe: guarded by `queue.length` on the line above. Not an entity-shape
    // assertion — TS simply can't tie `shift()` to the loop condition.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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

/**
 * Clears an orthogonal L-shaped corridor (x then y) — guarantees a path.
 *
 * `minCorridorTiles` wide, not one: a single-tile slot would satisfy
 * connectivity and violate the rule `sealNarrowGround` exists to enforce, and the
 * next sealing pass would fill the corridor straight back in.
 */
function carveCorridor(grid: TerrainGrid, a: { tx: number; ty: number }, b: { tx: number; ty: number }): void {
  const span = gameConfig.obstacles.minCorridorTiles;
  const reach = Math.floor(span / 2);
  let x = a.tx;
  let y = a.ty;
  const clear = () => {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (inBounds(x + dx, y + dy)) grid[y + dy][x + dx] = TerrainKind.Open;
      }
    }
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

/**
 * True if a body of `radius` can drive straight from `a` to `b` without
 * clipping anything on `grid` — the segment itself and both flanks of the
 * corridor it sweeps.
 *
 * **Not** `hasLineOfSight`, and the difference is two things at once. That one
 * asks a question about *fire*, so it reads `sightBlockers` (mountains only, a
 * crater is shot over) and it has no width: a round is a point. This asks a
 * question about *driving*, so it reads `navObstacles` and a hull is 22 px wide
 * — a diagonal that threads exactly between two rocks is a clean line of sight
 * and an impassable route.
 *
 * Sampled rather than rasterised: half a tile between samples, so nothing
 * narrower than a tile can hide between two of them, and three probes per sample
 * (centre and both flanks). Callers use it to prove a shortcut is safe, so it
 * must never say yes wrongly; saying no wrongly only costs a corner that could
 * have been cut.
 */
export function hasClearance(grid: ObstacleGrid, a: Vec2, b: Vec2, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = vecLength(dx, dy);
  const steps = Math.max(1, Math.ceil(len / (gameConfig.grid.tilePx / 2)));
  const nx = len > 1e-6 ? -dy / len : 0;
  const ny = len > 1e-6 ? dx / len : 0;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    for (const side of [0, radius, -radius]) {
      const tile = tileOf({ x: px + nx * side, y: py + ny * side });
      if (isBlockedGrid(grid, tile.tx, tile.ty)) return false;
    }
  }
  return true;
}
