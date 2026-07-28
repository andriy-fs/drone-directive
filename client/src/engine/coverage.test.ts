import { afterAll, describe, expect, it } from 'vitest';
import { applyMapSize, gameConfig } from '../config/gameConfig';
import { MapSize, TerrainKind } from '../types/enums';
import { createRng } from '../utils/rng';
import { generateObstacles } from './obstacles';

/** Share of tiles that are impassable, averaged over several seeds. */
function blockedShare(runs: number): number {
  const n = gameConfig.grid.width;
  let blocked = 0;
  for (let seed = 0; seed < runs; seed++) {
    for (const row of generateObstacles(createRng(seed))) {
      for (const kind of row) if (kind !== TerrainKind.Open) blocked++;
    }
  }
  return blocked / (n * n * runs);
}

describe('obstacle density', () => {
  // `applyMapSize` mutates the shared grid config, so put it back for other suites.
  afterAll(() => applyMapSize(MapSize.Small));

  it('stays roughly constant across map sizes rather than thinning out on big maps', () => {
    const shares = [MapSize.Small, MapSize.Medium, MapSize.Large].map((size) => {
      applyMapSize(size);
      return blockedShare(12);
    });

    for (const share of shares) {
      expect(share).toBeGreaterThan(0.12);
      expect(share).toBeLessThan(0.3);
    }
    // The point of area-scaling `blobCount`: the largest map is not markedly
    // emptier than the smallest.
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.05);
  });
});
