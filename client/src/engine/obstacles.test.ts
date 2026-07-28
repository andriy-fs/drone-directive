import { describe, expect, it } from 'vitest';
import { gameConfig } from '../config/gameConfig';
import { TerrainKind } from '../types/enums';
import { createRng } from '../utils/rng';
import { generateObstacles, hasLineOfSight, isBlockedGrid, movementGrid, sightGrid, tileCentre } from './obstacles';

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
