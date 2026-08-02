import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type GameSettings } from '../config/gameSettings';
import { GameEngine } from './game/engine';
import { MapSize, Owner } from '@drone-directive/types/enums';
import { worldHash } from './worldHash';

/**
 * The desync detector is only worth having if it actually fires. These run two
 * engines the way two peers would and check the hash agrees when they simulate
 * the same match, and disagrees the moment one of them drifts.
 */

const DT = 1 / 30;

function settings(aiOpponents: number): GameSettings {
  const s = createDefaultSettings();
  s.match.mapSize = MapSize.Small;
  s.match.aiOpponents = aiOpponents;
  s.match.online = true;
  return s;
}

function peer(localSide: Owner, aiOpponents: number, ticks: number): GameEngine {
  const e = new GameEngine();
  e.startMatch(settings(aiOpponents), 0xbeef);
  e.setLocalSide(localSide);
  for (let t = 0; t < ticks; t++) e.tick(DT);
  return e;
}

describe('worldHash', () => {
  it('agrees between peers simulating the same match', () => {
    // Sequentially, because the entity-id counter is module-global.
    const host = worldHash(peer(Owner.Player, 1, 300).world);
    const guest = worldHash(peer(Owner.AI, 1, 300).world);
    expect(guest).toBe(host);
  });

  it('notices a single robot a thousandth of a pixel out of place', () => {
    const a = peer(Owner.Player, 1, 120);
    const before = worldHash(a.world);
    const robot = a.world.with('robot', 'position').entities[0];
    robot.position.x += 0.001;
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('notices a difference in hp', () => {
    const a = peer(Owner.Player, 1, 120);
    const before = worldHash(a.world);
    const robot = a.world.with('robot').entities[0];
    robot.hp = (robot.hp ?? 0) - 1;
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('ignores presentation state, which legitimately differs per client', () => {
    const a = peer(Owner.Player, 1, 120);
    const before = worldHash(a.world);
    // Fog is computed for `localSide` and is not part of the shared simulation.
    a.setLocalSide(Owner.AI);
    a.tick(DT);
    a.setLocalSide(Owner.Player);
    const b = peer(Owner.Player, 1, 121);
    expect(worldHash(a.world)).toBe(worldHash(b.world));
    expect(before).not.toBe(worldHash(b.world)); // sanity: the extra tick did change the world
  });
});
