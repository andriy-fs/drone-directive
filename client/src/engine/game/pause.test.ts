import { describe, expect, it } from 'vitest';
import { ChassisType, Difficulty, MapSize, Owner, WeaponType } from '@drone-directive/types/enums';
import { createDefaultSettings } from '../../config/gameSettings';
import type { BaseEntity } from '../ecs/archetypes';
import { bases, robots } from '../ecs/queries';
import { GameEngine } from './engine';

/**
 * A paused tick still drains the command queue.
 *
 * The world holds still — that is what pause is for — but a build queue is a
 * list of intentions the factory has not acted on yet, and editing it changes
 * nothing that is happening. Before this, a paused solo game *held* the orders
 * and applied them all at once on unpause, which read to the player as a dead
 * button; see `.docs/internal/todo/commands-while-paused.md`.
 *
 * Which kinds get this far is the app layer's call (`isAllowedWhilePaused`,
 * filtered where input is sampled). The engine applies whatever it is handed —
 * that is the point: one code path, identical on both peers.
 */
const DT = 1 / 30;

function startedEngine(): { engine: GameEngine; base: BaseEntity } {
  const settings = createDefaultSettings();
  settings.match.difficulty = Difficulty.Normal;
  settings.match.mapSize = MapSize.Medium;
  settings.match.aiOpponents = 1;

  const engine = new GameEngine();
  engine.startMatch(settings, 7);
  const base = bases(engine.world).entities.find((b) => b.owner === Owner.Player);
  expect(base).toBeDefined();
  if (!base) throw new Error('no player base');
  return { engine, base };
}

const order = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };

describe('commands while the match is paused', () => {
  it('applies a build order on the very tick it is paused', () => {
    const { engine, base } = startedEngine();
    engine.setPaused(true);
    engine.enqueueCommand({ kind: 'BuildRobot', baseId: base.id, order, front: false });
    engine.tick(DT);

    expect(base.production.queue).toHaveLength(1);
  });

  it('does not let the factory act on it while still paused', () => {
    const { engine, base } = startedEngine();
    const before = robots(engine.world).entities.length;
    engine.setPaused(true);
    engine.enqueueCommand({ kind: 'BuildRobot', baseId: base.id, order, front: false });
    for (let i = 0; i < 300; i++) engine.tick(DT);

    expect(base.production.queue).toHaveLength(1);
    expect(base.production.progress).toBe(0);
    expect(base.production.funded).toBe(false);
    expect(robots(engine.world).entities.length).toBe(before);
  });

  it('does not replay the order when the pause lifts', () => {
    const { engine, base } = startedEngine();
    engine.setPaused(true);
    engine.enqueueCommand({ kind: 'BuildRobot', baseId: base.id, order, front: false });
    engine.tick(DT);
    engine.setPaused(false);
    engine.tick(DT);

    expect(base.production.queue).toHaveLength(1);
  });

  it('takes a queued order back while paused, refund and all', () => {
    const { engine, base } = startedEngine();
    engine.enqueueCommand({ kind: 'BuildRobot', baseId: base.id, order, front: false });
    engine.tick(DT); // running: the head gets funded
    expect(base.production.funded).toBe(true);
    const spent = engine.context?.resources[Owner.Player] ?? 0;

    engine.setPaused(true);
    engine.enqueueCommand({ kind: 'CancelQueued', baseId: base.id, index: 0, order });
    engine.tick(DT);

    expect(base.production.queue).toHaveLength(0);
    expect(base.production.funded).toBe(false);
    expect(engine.context?.resources[Owner.Player] ?? 0).toBeGreaterThan(spent);
  });
});
