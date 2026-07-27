import { describe, expect, it } from 'vitest';
import { applyEnemyCorner, applyMapSize, ENEMY_CORNERS, gameConfig } from '../../config/gameConfig';
import { createDefaultSettings, type GameSettings } from '../../config/gameSettings';
import { MapSize, Owner } from '../../types/enums';
import { GameEngine } from './engine';

/**
 * The enemy base rotates between the three corners the player doesn't hold, so a
 * match isn't always the same diagonal. The roll comes from the match rng, which
 * keeps networked peers on the same map (see determinism.test.ts).
 */

function placement(owner: 'player' | 'ai') {
  return gameConfig.bases.placements.find((p) => p.owner === owner)!;
}

function settings(size: MapSize): GameSettings {
  const s = createDefaultSettings();
  s.match.online = true; // no bot, so `startMatch` stays cheap
  s.match.mapSize = size;
  return s;
}

/** Top-left tile of the enemy base after starting a match with `seed`. */
function enemyCornerFor(seed: number, size: MapSize = MapSize.Small): { tx: number; ty: number } {
  new GameEngine().startMatch(settings(size), seed);
  const { tx, ty } = placement('ai');
  return { tx, ty };
}

describe('base placement — enemy corner', () => {
  it('puts the enemy in the named corner, never on top of the player', () => {
    applyMapSize(MapSize.Small);
    const n = gameConfig.mapSize.small;
    const near = 4;
    const far = n - gameConfig.bases.footprintTiles - 4;

    expect(placement('player')).toMatchObject({ tx: near, ty: far });

    applyEnemyCorner('topLeft');
    expect(placement('ai')).toMatchObject({ tx: near, ty: near });
    applyEnemyCorner('topRight');
    expect(placement('ai')).toMatchObject({ tx: far, ty: near });
    applyEnemyCorner('bottomRight');
    expect(placement('ai')).toMatchObject({ tx: far, ty: far });

    // The player's own corner is never one of the options.
    for (const corner of ENEMY_CORNERS) {
      applyEnemyCorner(corner);
      expect(placement('ai')).not.toEqual(placement('player'));
    }
  });

  it('scales the corners with the map size', () => {
    applyMapSize(MapSize.Large);
    applyEnemyCorner('bottomRight');
    const far = gameConfig.mapSize.large - gameConfig.bases.footprintTiles - 4;
    expect(placement('ai')).toMatchObject({ tx: far, ty: far });
  });

  it('reaches all three corners across matches, and repeats for a repeated seed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const { tx, ty } = enemyCornerFor(seed);
      seen.add(`${tx},${ty}`);
    }
    expect(seen.size).toBe(ENEMY_CORNERS.length);

    expect(enemyCornerFor(0xbeef)).toEqual(enemyCornerFor(0xbeef));
  });

  it('spawns each side\'s starter robots on the inward side of its own base', () => {
    const engine = new GameEngine();
    engine.startMatch(settings(MapSize.Small), 7);
    const half = (gameConfig.grid.width * gameConfig.grid.tilePx) / 2;

    for (const base of engine.world.with('base', 'position').entities) {
      const starters = engine.world
        .with('robot', 'position')
        .entities.filter((r) => r.owner === base.owner);
      expect(starters.length).toBeGreaterThan(0);
      // Robots sit between their base and the middle of the map, never outside it.
      for (const r of starters) {
        const towardMiddle = base.position.x < half ? r.position.x > base.position.x : r.position.x < base.position.x;
        expect(towardMiddle).toBe(true);
      }
    }
    // Sanity: both sides really were placed (the AI side is the one that moves).
    const owners = engine.world.with('base').entities.map((b) => b.owner);
    expect(new Set(owners)).toEqual(new Set([Owner.Player, Owner.AI]));
  });
});
