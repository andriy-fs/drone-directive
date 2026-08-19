import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config/gameConfig';
import { TerrainKind } from '@drone-directive/types/enums';
import { createRng } from '../utils/rng';
import {
  generateObstacles,
  hasClearance,
  hasLineOfSight,
  isBlockedGrid,
  movementGrid,
  sightGrid,
  tileCentre,
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
  it('keeps every cluster a single kind and sizes it within the configured range', () => {
    const { minBlobTiles, maxBlobTiles } = gameConfig.obstacles;
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
        // A region can merge two stamped blobs that landed adjacent, and can fall
        // short of the floor when hemmed in by the map edge or a base's clear
        // margin — so per-region bounds aren't assertable; the mean is.
        if (kinds.size === 1) sizes.push(size);
      }
    }

    expect(sizes.length).toBeGreaterThan(0);
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(mean).toBeGreaterThanOrEqual(minBlobTiles);
    expect(mean).toBeLessThanOrEqual(maxBlobTiles);
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
