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
  it('keeps every cluster a single kind, and builds massifs without swallowing the map', () => {
    const { minBlobTiles } = gameConfig.obstacles;
    const terrain = generateObstacles(createRng(11));
    const seen = new Set<string>();
    const sizes: number[] = [];

    // Flood-fill each connected blocked region (8-directional, as clusters read visually).
    for (let ty = 0; ty < terrain.length; ty++) {
      for (let tx = 0; tx < terrain[ty].length; tx++) {
        const kind = terrain[ty][tx];
        if (kind === TerrainKind.Open || seen.has(`${tx},${ty}`)) continue;
        const queue = [{ tx, ty }];
        seen.add(`${tx},${ty}`);
        let size = 0;
        const kinds = new Set<TerrainKind>();
        while (queue.length) {
          const cur = queue.shift()!;
          size++;
          kinds.add(terrain[cur.ty][cur.tx]);
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cur.tx + dx;
              const ny = cur.ty + dy;
              const k = `${nx},${ny}`;
              if (seen.has(k) || terrain[ny]?.[nx] === undefined || terrain[ny][nx] === TerrainKind.Open) continue;
              seen.add(k);
              queue.push({ tx: nx, ty: ny });
            }
          }
        }
        if (kinds.size === 1) sizes.push(size);
      }
    }

    // A region bigger than `maxBlobTiles` is the **point**, not a defect: clusters are
    // seeded next to one another (`chainChance`) so ridges merge into massifs, and
    // `sealNarrowGround` fills the necks between the ones that only nearly touch. What
    // is worth pinning down is the other end — that the merging stops somewhere.
    expect(sizes.length).toBeGreaterThan(0);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(mean).toBeGreaterThanOrEqual(minBlobTiles);

    // Several masses, and no single one that has eaten the battlefield: at `chainChance`
    // 1 the map degenerates into one wandering wall, which is the failure this guards.
    const blocked = sizes.reduce((a, b) => a + b, 0);
    expect(sizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...sizes) / blocked).toBeLessThan(0.65);
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
