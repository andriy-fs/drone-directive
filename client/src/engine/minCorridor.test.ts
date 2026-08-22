import { describe, expect, it } from 'vitest';
import { MapSize } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../config/gameConfig';
import { createDefaultSettings } from '../config/gameSettings';
import { createRng } from '../utils/rng';
import { resetIds } from '../utils/id';
import { createEcsWorld } from './ecs/world';
import { spawnBase } from './ecs/factory';
import { createGameContext } from './game/context';
import { EventBus } from './game/eventBus';
import type { GameEvents } from './game/events';
import { refreshNavObstacles } from './navGrid';
import { generateObstacles, isBlockedGrid, movementGrid, sightGrid, type ObstacleGrid } from './obstacles';

/**
 * The minimum-corridor guarantee, pinned.
 *
 * `generateObstacles` fills in any drivable ground not covered by a fully-free
 * `obstacles.minCorridorTiles` square (`sealNarrowGround`). The movement and
 * formation layers are allowed to *rely* on that: `formation.test.ts` sweeps
 * hairpin widths starting at the guarantee rather than at one tile, precisely
 * because a narrower pass is geometry no generated map can produce.
 *
 * That is a load-bearing assumption living in another file, so it is asserted
 * here rather than trusted. Two ways it could quietly stop being true:
 *
 * - **Base footprints are stamped after the seal.** `sealNarrowGround` runs
 *   inside `generateObstacles` and only ever sees terrain; `refreshNavObstacles`
 *   then adds a 3x3 block per living base to the grid units actually path on. A
 *   footprint dropped beside a mountain could pinch a corridor the generator had
 *   already approved, so the check below runs against `navObstacles`, with bases
 *   spawned, at every side count the game offers.
 * - **More sides means more footprints.** `applySidePlacements` rewrites
 *   `bases.placements` per roster, so a 4-player map stamps twice the blockers a
 *   1v1 does.
 *
 * Measured 2026-08-22: zero narrow tiles across 3 map sizes x 2-4 sides x 8 seeds.
 *
 * Worth knowing when this contradicts what the screen shows: a corridor at the
 * guarantee **looks** far narrower than it is. Craters draw an ejecta halo at
 * `EJECTA_SPREAD` 1.55x their bounding box, spraying debris ~1.65 tiles past
 * their own edge onto drivable ground, and mountains cast a shadow 9 px out with
 * a 7 px feather. A 96 px pass between a crater and a mountain can read as about
 * 27 px of clear ground. It is paint, not rock — this test is what says so.
 */

/** Is `tx,ty` inside some fully-free `span` square? Mirrors `inWideGround`. */
function inWideGround(grid: ObstacleGrid, tx: number, ty: number, span: number): boolean {
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

/** Every drivable tile that no fully-free `span` square covers. */
function narrowTiles(grid: ObstacleGrid, span: number): string[] {
  const { width, height } = gameConfig.grid;
  const out: string[] = [];
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      if (isBlockedGrid(grid, tx, ty)) continue;
      if (!inWideGround(grid, tx, ty, span)) out.push(`${tx},${ty}`);
    }
  }
  return out;
}

/** A seeded match with `aiOpponents` bots, every side's base on the grid. */
function mapWithBases(seed: number, size: MapSize, aiOpponents: number): ObstacleGrid {
  resetIds();
  applyMapSize(size);
  const settings = createDefaultSettings();
  settings.match.mapSize = size;
  settings.match.aiOpponents = aiOpponents;
  const ctx = createGameContext(createEcsWorld(), new EventBus<GameEvents>(), [], settings, seed);
  ctx.rng = createRng(seed);
  ctx.terrain = generateObstacles(ctx.rng);
  ctx.obstacles = movementGrid(ctx.terrain);
  ctx.sightBlockers = sightGrid(ctx.terrain);
  ctx.navObstacles = ctx.obstacles;
  for (const p of gameConfig.bases.placements) spawnBase(ctx.world, p.owner, p.tx, p.ty);
  refreshNavObstacles(ctx);
  return ctx.navObstacles;
}

describe('generated maps never contain ground narrower than the guarantee', () => {
  const span = gameConfig.obstacles.minCorridorTiles;
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

  for (const size of [MapSize.Small, MapSize.Medium, MapSize.Large]) {
    for (const ai of [1, 2, 3]) {
      it(`${size} map, ${ai + 1} sides, with every base stamped`, () => {
        for (const seed of seeds) {
          const grid = mapWithBases(seed, size, ai);
          // Guards the guard: a roster that silently stayed at two sides would
          // make the multi-base arms of this sweep vacuous.
          expect(gameConfig.bases.placements.length).toBe(ai + 1);
          const narrow = narrowTiles(grid, span);
          expect(narrow.slice(0, 8), `seed ${seed}: drivable tiles below ${span} tiles of width`).toEqual([]);
        }
      });
    }
  }

  it('restores the default map size for whatever runs next', () => {
    applyMapSize(MapSize.Medium);
    expect(gameConfig.grid.width).toBe(gameConfig.mapSize.medium);
  });
});
