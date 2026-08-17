import { describe, expect, it } from 'vitest';
import { applyMapSize, applySidePlacements, ENEMY_CORNERS, gameConfig } from '../../config/gameConfig';
import { createDefaultSettings, type GameSettings } from '../../config/gameSettings';
import { MapSize, Owner } from '@drone-directive/types/enums';
import { GameEngine } from './engine';

/**
 * The player keeps the bottom-left corner; every opponent draws one of the other
 * three, so a match isn't always the same diagonal and a four-way match seats one
 * side per corner. The draw comes from the match rng, which keeps networked peers
 * on the same map (see determinism.test.ts).
 */

function placement(owner: Owner) {
  return gameConfig.bases.placements.find((p) => p.owner === owner)!;
}

function settings(size: MapSize, aiOpponents = 1): GameSettings {
  const s = createDefaultSettings();
  s.match.mapSize = size;
  s.match.aiOpponents = aiOpponents;
  return s;
}

/** Top-left tile of the (single) enemy base after starting a match with `seed`. */
function enemyCornerFor(seed: number, size: MapSize = MapSize.Small): { tx: number; ty: number } {
  new GameEngine().startMatch(settings(size), seed);
  const { tx, ty } = placement(Owner.AI);
  return { tx, ty };
}

describe('base placement — corners', () => {
  it('seats each side in a corner of its own, never on top of the player', () => {
    applyMapSize(MapSize.Small);
    const n = gameConfig.mapSize.small;
    const near = 4;
    const far = n - gameConfig.bases.footprintTiles - 4;

    applySidePlacements([Owner.Player, Owner.AI]);
    expect(placement(Owner.Player)).toMatchObject({ tx: near, ty: far });
    // Unshuffled, the first opponent takes the historical diagonal.
    expect(placement(Owner.AI)).toMatchObject({ tx: far, ty: near });

    // A full table fills all four corners, one side each.
    applySidePlacements([Owner.Player, Owner.AI, Owner.AI2, Owner.AI3]);
    const tiles = gameConfig.bases.placements.map((p) => `${p.tx},${p.ty}`);
    expect(tiles).toHaveLength(4);
    expect(new Set(tiles).size).toBe(4);
    expect(new Set(tiles)).toEqual(new Set([`${near},${far}`, `${near},${near}`, `${far},${near}`, `${far},${far}`]));
    // The player's own corner is never dealt to an opponent.
    expect(placement(Owner.Player)).toMatchObject({ tx: near, ty: far });
  });

  it('drops sides that are sitting the match out', () => {
    applyMapSize(MapSize.Small);
    applySidePlacements([Owner.Player, Owner.AI, Owner.AI2]);
    expect(gameConfig.bases.placements).toHaveLength(3);
    applySidePlacements([Owner.Player, Owner.AI]);
    expect(gameConfig.bases.placements.map((p) => p.owner)).toEqual([Owner.Player, Owner.AI]);
  });

  it('scales the corners with the map size', () => {
    applyMapSize(MapSize.Large);
    applySidePlacements([Owner.Player, Owner.AI, Owner.AI2, Owner.AI3]);
    const far = gameConfig.mapSize.large - gameConfig.bases.footprintTiles - 4;
    const corners = gameConfig.bases.placements.map((p) => `${p.tx},${p.ty}`);
    expect(corners).toContain(`${far},${far}`);
    expect(corners).toContain(`4,${far}`);
  });

  it('reaches all three enemy corners across matches, and repeats for a repeated seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const { tx, ty } = enemyCornerFor(seed);
      seen.add(`${tx},${ty}`);
    }
    expect(seen.size).toBe(ENEMY_CORNERS.length);

    expect(enemyCornerFor(0xbeef)).toEqual(enemyCornerFor(0xbeef));
  });

  it('seats every side with a base and an observer drone, and no robots at all', () => {
    const engine = new GameEngine();
    engine.startMatch(settings(MapSize.Small, 3), 7);

    // A four-way match really seats four distinct sides…
    const owners = engine.world.with('base').entities.map((b) => b.owner);
    expect(new Set(owners)).toEqual(new Set([Owner.Player, Owner.AI, Owner.AI2, Owner.AI3]));
    // …each with its eye…
    expect(new Set(engine.world.with('drone').entities.map((d) => d.owner))).toEqual(new Set(owners));
    // …and nobody is handed a single robot: every unit in the match is produced.
    expect(engine.world.with('robot').entities).toHaveLength(0);
  });
});
