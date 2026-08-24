import { afterAll, describe, expect, it } from 'vitest';
import { applyMapSize, gameConfig } from '../config/gameConfig';
import { MapSize, TerrainKind } from '@drone-directive/types/enums';
import { createRng } from '../utils/rng';
import { findPath } from './pathfinding';
import {
  generateObstacles,
  hasClearance,
  hasLineOfSight,
  isBlockedGrid,
  movementGrid,
  sightGrid,
  tileCentre,
  withBaseFootprints,
  type ObstacleGrid,
} from './obstacles';

/** A 3-wide map row of one kind, flanked by open ground, for straight-line LOS checks. */
function stripe(kind: TerrainKind): TerrainKind[][] {
  const { width, height } = gameConfig.grid;
  const grid: TerrainKind[][] = Array.from({ length: height }, () =>
    new Array<TerrainKind>(width).fill(TerrainKind.Open),
  );
  for (let ty = 0; ty < height; ty++) grid[ty][10] = kind;
  return grid;
}

/** Inside the clear margin `generateObstacles` keeps around a base, where terrain may not go. */
function inBaseMargin(tx: number, ty: number): boolean {
  const fp = gameConfig.bases.footprintTiles;
  const margin = gameConfig.obstacles.baseClearMargin;
  return gameConfig.bases.placements.some(
    (p) => tx >= p.tx - margin && tx < p.tx + fp + margin && ty >= p.ty - margin && ty < p.ty + fp + margin,
  );
}

describe('terrain kinds — movement vs line of fire', () => {
  it('blocks driving through both a mountain and a crater', () => {
    for (const kind of [TerrainKind.Mountain, TerrainKind.Crater]) {
      expect(isBlockedGrid(movementGrid(stripe(kind)), 10, 5)).toBe(true);
    }
  });

  it('blocks line of fire through a mountain but not through a crater', () => {
    const from = tileCentre(5, 5);
    const to = tileCentre(15, 5);
    expect(hasLineOfSight(sightGrid(stripe(TerrainKind.Mountain)), from, to)).toBe(false);
    expect(hasLineOfSight(sightGrid(stripe(TerrainKind.Crater)), from, to)).toBe(true);
  });
});

describe('generateObstacles', () => {
  it('builds massifs without letting one swallow the battlefield', () => {
    const { minBlobTiles } = gameConfig.obstacles;

    // Flood-fill **within one kind**, 8-directional — the way `pixi/render/terrain/
    // clusters.ts` reads a landform, and the only way that means anything now: at the
    // current cover a mountain and a crater touch on most maps, so a fill that crossed
    // kinds would report the whole field as one region and measure nothing.
    const masses = (terrain: TerrainKind[][]): number[] => {
      const seen = new Set<string>();
      const sizes: number[] = [];
      for (let ty = 0; ty < terrain.length; ty++) {
        for (let tx = 0; tx < terrain[ty].length; tx++) {
          const kind = terrain[ty][tx];
          if (kind === TerrainKind.Open || seen.has(`${tx},${ty}`)) continue;
          const queue = [{ tx, ty }];
          seen.add(`${tx},${ty}`);
          let size = 0;
          while (queue.length) {
            const cur = queue.shift();
            if (!cur) break;
            size++;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = cur.tx + dx;
                const ny = cur.ty + dy;
                const k = `${nx},${ny}`;
                if (seen.has(k) || terrain[ny]?.[nx] !== kind) continue;
                seen.add(k);
                queue.push({ tx: nx, ty: ny });
              }
            }
          }
          sizes.push(size);
        }
      }
      return sizes;
    };

    // Several seeds, because the shape of one map says little: what is being pinned is
    // the distribution, and a single clumpy seed is a legitimate map rather than a bug.
    const shares: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const sizes = masses(generateObstacles(createRng(seed)));

      // A mass bigger than `maxBlobTiles` is the **point**, not a defect: clusters are
      // seeded next to one another (`chainChance`) so ridges merge into massifs, and
      // `sealNarrowGround` fills the necks between the ones that only nearly touch.
      // What is worth pinning down is the other end — that the merging stops somewhere.
      expect(sizes.length).toBeGreaterThanOrEqual(3);
      const blocked = sizes.reduce((a, b) => a + b, 0);
      expect(blocked / sizes.length).toBeGreaterThanOrEqual(minBlobTiles);
      // Not one wandering wall: that failure mode (lift `chainMax`, or take
      // `chainChance` to 1) puts essentially every blocked tile into a single mass.
      expect(Math.max(...sizes) / blocked).toBeLessThan(0.85);
      shares.push(Math.max(...sizes) / blocked);
    }

    // And typically much better than that ceiling — measured at 0.37 over 30 seeds.
    expect(shares.reduce((a, b) => a + b, 0) / shares.length).toBeLessThan(0.6);
  });

  it('lays cover in every part of the map, not just one side of it', () => {
    // Seeds were drawn uniformly before, which is uniform only in the limit: over 30
    // maps, 14 of the small ones and 27 of the medium ones came out with a whole
    // seedable region carrying no terrain at all, and what the player saw was every
    // massif on one side of the battlefield. Free seeds are dealt from a shuffled
    // tour of regions now (`seedRegionTiles`), which is what this pins.
    const { width, height } = gameConfig.grid;
    const n = Math.max(2, Math.round(width / gameConfig.obstacles.seedRegionTiles));

    for (let seed = 1; seed <= 12; seed++) {
      const terrain = generateObstacles(createRng(seed));
      const blocked = new Array<number>(n * n).fill(0);
      const seedable = new Array<number>(n * n).fill(0);

      for (let ty = 0; ty < height; ty++) {
        for (let tx = 0; tx < width; tx++) {
          const i = Math.min(n - 1, Math.floor((ty / height) * n)) * n + Math.min(n - 1, Math.floor((tx / width) * n));
          if (!inBaseMargin(tx, ty)) seedable[i]++;
          if (terrain[ty][tx] !== TerrainKind.Open) blocked[i]++;
        }
      }

      for (let i = 0; i < blocked.length; i++) {
        // A region that is mostly base margin is *supposed* to be bare — that is the
        // clear ground around a base, not a hole in the map.
        if (seedable[i] < ((width / n) * (height / n)) / 3) continue;
        expect(blocked[i]).toBeGreaterThan(0);
      }
    }
  });

  it('gives every base something to fight around', () => {
    // Fairness, not scenery: a side that has to cross open ground while its opponent
    // has ridges to hide behind is playing a different match. Before `ensureBaseCover`
    // that was one base in seven on the small map and one in four on the medium.
    const { baseClearMargin, baseCover } = gameConfig.obstacles;

    for (let seed = 1; seed <= 12; seed++) {
      const terrain = generateObstacles(createRng(seed));
      for (const placement of gameConfig.bases.placements) {
        const cx = placement.tx + Math.floor(gameConfig.bases.footprintTiles / 2);
        const cy = placement.ty + Math.floor(gameConfig.bases.footprintTiles / 2);
        let cover = 0;
        for (let ty = 0; ty < gameConfig.grid.height; ty++) {
          for (let tx = 0; tx < gameConfig.grid.width; tx++) {
            const d = Math.max(Math.abs(tx - cx), Math.abs(ty - cy));
            if (d <= baseClearMargin || d > baseCover.radius) continue;
            if (terrain[ty][tx] !== TerrainKind.Open) cover++;
          }
        }
        expect(cover).toBeGreaterThanOrEqual(baseCover.tiles);
      }
    }
  });

  it('produces both terrain kinds across a map', () => {
    const kinds = new Set(generateObstacles(createRng(3)).flat());
    expect(kinds.has(TerrainKind.Mountain)).toBe(true);
    expect(kinds.has(TerrainKind.Crater)).toBe(true);
  });
});

/**
 * The width question, which `hasLineOfSight` deliberately does not answer: a
 * shot is a point and a hull is 22 px across, so a diagonal that threads between
 * two rocks is a clean line of fire and an impassable route.
 */
describe('hasClearance', () => {
  const radius: number = gameConfig.robots.radius;

  /** An open grid with the listed tiles blocked. */
  function grid(blocked: readonly (readonly [number, number])[]): boolean[][] {
    const { width, height } = gameConfig.grid;
    const g = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
    for (const [tx, ty] of blocked) g[ty][tx] = true;
    return g;
  }

  it('passes a hull down open ground', () => {
    expect(hasClearance(grid([]), tileCentre(2, 2), tileCentre(12, 9), radius)).toBe(true);
  });

  it('refuses a segment that crosses a blocked tile', () => {
    const g = grid([[7, 2]]);
    expect(hasClearance(g, tileCentre(2, 2), tileCentre(12, 2), radius)).toBe(false);
  });

  it('refuses a gap a round would fly through but a hull would not fit', () => {
    // Two rocks diagonally adjacent: the corner between them is a clear line but
    // there is nowhere for a 22 px body to be while it crosses.
    const g = grid([
      [6, 5],
      [7, 6],
    ]);
    const from = tileCentre(6, 6);
    const to = tileCentre(7, 5);
    expect(hasLineOfSight(g, from, to)).toBe(true);
    expect(hasClearance(g, from, to, radius)).toBe(false);
  });

  it('reports a single point by the ground it stands on', () => {
    const at = tileCentre(4, 4);
    expect(hasClearance(grid([]), at, at, radius)).toBe(true);
    expect(hasClearance(grid([[4, 4]]), at, at, radius)).toBe(false);
  });
});


/**
 * The guarantee generated ground owes the units driving on it: **nothing
 * drivable is narrower than `minCorridorTiles`**.
 *
 * Stated as "every free tile is covered by some fully-free 3×3 block", which is
 * the morphological opening of the free space and rules out in one sentence a
 * one- or two-tile corridor, a one-tile alcove, and the diagonal squeeze that is
 * a clean line of fire and an impassable route.
 *
 * It exists because of what narrow ground does to a group. Every formation
 * deadlock found so far needed a one- or two-tile pass to bite — see
 * `.docs/issues/formation-deadlock-at-a-hairpin.md` — and this is what stops a
 * generated map containing the geometry at all. Exact, not statistical: one tile
 * anywhere on any seed is a hole in it.
 */
describe('generateObstacles — the minimum corridor', () => {
  const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17];

  afterAll(() => {
    // `applyMapSize` writes to the shared config; put it back for whatever runs next.
    applyMapSize(MapSize.Medium);
  });

  /** Free tiles no fully-free `minCorridorTiles` square covers. */
  function narrowTiles(grid: ObstacleGrid): { tx: number; ty: number }[] {
    const span = gameConfig.obstacles.minCorridorTiles;
    const { width, height } = gameConfig.grid;
    const narrow: { tx: number; ty: number }[] = [];
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (isBlockedGrid(grid, tx, ty)) continue;
        let covered = false;
        for (let oy = -(span - 1); oy <= 0 && !covered; oy++) {
          for (let ox = -(span - 1); ox <= 0 && !covered; ox++) {
            let clear = true;
            for (let dy = 0; dy < span && clear; dy++) {
              for (let dx = 0; dx < span && clear; dx++) {
                if (isBlockedGrid(grid, tx + ox + dx, ty + oy + dy)) clear = false;
              }
            }
            if (clear) covered = true;
          }
        }
        if (!covered) narrow.push({ tx, ty });
      }
    }
    return narrow;
  }

  /** Every base footprint stamped in, the way `navGrid.refreshNavObstacles` does it at match start. */
  function withBases(grid: ObstacleGrid): ObstacleGrid {
    const { tilePx } = gameConfig.grid;
    const fp = gameConfig.bases.footprintTiles;
    return withBaseFootprints(
      grid,
      gameConfig.bases.placements.map((p) => ({
        position: { x: (p.tx + fp / 2) * tilePx, y: (p.ty + fp / 2) * tilePx },
        footprint: fp,
      })),
    );
  }

  for (const size of [MapSize.Small, MapSize.Medium, MapSize.Large]) {
    it(`leaves no drivable ground narrower than the minimum on a ${size} map`, () => {
      applyMapSize(size);
      for (const seed of SEEDS) {
        const grid = movementGrid(generateObstacles(createRng(seed)));
        const narrow = narrowTiles(grid);
        expect(
          narrow.length,
          `seed ${seed}: ${narrow.length} narrow tiles, first at ${narrow[0]?.tx},${narrow[0]?.ty}`,
        ).toBe(0);
      }
    }, 30_000);

    it(`still connects every base on a ${size} map`, () => {
      applyMapSize(size);
      const fp = gameConfig.bases.footprintTiles;
      for (const seed of SEEDS) {
        const grid = movementGrid(generateObstacles(createRng(seed)));
        const [a, b] = gameConfig.bases.placements;
        const centre = (p: { tx: number; ty: number }) => tileCentre(p.tx + (fp >> 1), p.ty + (fp >> 1));
        // `findPath` is the thing that actually has to succeed at match time, so
        // ask it rather than a private reachability helper.
        expect(findPath(grid, centre(a), centre(b)).length, `seed ${seed}`).toBeGreaterThan(0);
      }
    }, 30_000);
  }

  it('holds once the bases themselves are stamped into the navigation grid', () => {
    // A living base is a 7×7 obstacle that terrain never sees. It cannot pinch a
    // pass — `baseClearMargin` keeps 6 tiles clear around it — but that is a
    // relationship between two config numbers, and this is what notices if either
    // moves.
    applyMapSize(MapSize.Medium);
    for (const seed of SEEDS) {
      const narrow = narrowTiles(withBases(movementGrid(generateObstacles(createRng(seed)))));
      expect(narrow.length, `seed ${seed}: first at ${narrow[0]?.tx},${narrow[0]?.ty}`).toBe(0);
    }
  }, 30_000);

  it('keeps cover in the band the balance was tuned for', () => {
    // Sealing fills ground, so this is the guard against the failure mode where
    // it snowballs: a filled neck merges two blobs, which can pinch a new neck
    // against a third. A band, not a number — `blobCount` is meant to be tuned.
    applyMapSize(MapSize.Medium);
    const { width, height } = gameConfig.grid;
    let blocked = 0;
    for (const seed of SEEDS) {
      const terrain = generateObstacles(createRng(seed));
      blocked += terrain.flat().filter((k) => k !== TerrainKind.Open).length / (width * height);
    }
    const share = blocked / SEEDS.length;
    expect(share, `cover is ${(share * 100).toFixed(1)}% of the map`).toBeGreaterThan(0.15);
    expect(share, `cover is ${(share * 100).toFixed(1)}% of the map`).toBeLessThan(0.27);
  }, 30_000);
});
