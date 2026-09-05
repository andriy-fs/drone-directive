import { describe, expect, it } from 'vitest';
import { createDefaultSettings, type GameSettings } from '../config/gameSettings';
import { GameEngine } from './game/engine';
import { FormationType, MapSize, OverrideKind, Owner } from '@drone-directive/types/enums';
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

  // 300 ticks (10 s), not the 120 the other cases use: no side starts with
  // robots, so the world holds none until the bot's first build lands (~7 s).
  it('notices a single robot a thousandth of a pixel out of place', () => {
    const a = peer(Owner.Player, 1, 300);
    const before = worldHash(a.world);
    const robot = a.world.with('robot', 'position').entities[0];
    robot.position.x += 0.001;
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('notices a difference in hp', () => {
    const a = peer(Owner.Player, 1, 300);
    const before = worldHash(a.world);
    const robot = a.world.with('robot').entities[0];
    robot.hp = (robot.hp ?? 0) - 1;
    expect(worldHash(a.world)).not.toBe(before);
  });

  // The energy dome is the one piece of simulation state not observable through
  // hp — it exists precisely to stop hp from moving — so if it fell out of the
  // hash a peer could absorb a volley the other took on the chin and nothing
  // would say so until the base died on one side only.
  it('notices a dome raised on one peer and not the other', () => {
    const a = peer(Owner.Player, 1, 120);
    const before = worldHash(a.world);
    const base = a.world.with('base', 'position').entities[0];
    a.world.addComponent(base, 'shield', { hp: 1000, left: 20 });
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('notices a dome a thousandth of a point weaker, or a thousandth of a second older', () => {
    const a = peer(Owner.Player, 1, 120);
    const base = a.world.with('base', 'position').entities[0];
    a.world.addComponent(base, 'shield', { hp: 1000, left: 20 });
    const before = worldHash(a.world);

    base.shield!.hp -= 0.001;
    const weaker = worldHash(a.world);
    expect(weaker).not.toBe(before);

    base.shield!.left -= 0.001;
    expect(worldHash(a.world)).not.toBe(weaker);
  });

  it('notices a charge spent on one peer only', () => {
    const a = peer(Owner.Player, 1, 120);
    const before = worldHash(a.world);
    const base = a.world.with('base', 'position').entities[0];
    a.world.addComponent(base, 'shieldSpent', true);
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('notices a mode armed on one peer and not the other', () => {
    // The one piece of state that is *not* observable through hp, for exactly the
    // dome's reason: while `Shield` runs, stopping hp from moving is its whole job.
    // 300 ticks, like the formation case below: nothing has been produced yet at
    // 120, and a world with no robots would pass this test for the wrong reason.
    const a = peer(Owner.Player, 1, 300);
    const before = worldHash(a.world);
    const robot = a.world.with('robot', 'position').entities[0];
    robot.override = { kind: OverrideKind.Shield, left: 5 };
    expect(worldHash(a.world)).not.toBe(before);
  });

  it('notices a mode a thousandth of a second older, or of a different kind', () => {
    const a = peer(Owner.Player, 1, 300);
    const robot = a.world.with('robot', 'position').entities[0];
    robot.override = { kind: OverrideKind.Shield, left: 5 };
    const before = worldHash(a.world);

    robot.override.left -= 0.001;
    const older = worldHash(a.world);
    expect(older).not.toBe(before);

    // The kind matters as much as the clock: the two modes end the hull in
    // different ways, so peers disagreeing about which is running diverge at the
    // end of it, not during.
    robot.override.kind = OverrideKind.Overload;
    expect(worldHash(a.world)).not.toBe(older);
  });

  it('notices a formation one peer knows about and the other does not', () => {
    const a = peer(Owner.Player, 1, 300);
    const robot = a.world.with('script', 'movement').entities[0];
    expect(robot).toBeDefined();
    const before = worldHash(a.world);

    robot.script.blackboard.formation = { gid: 'g1', type: FormationType.Line };
    const formed = worldHash(a.world);
    expect(formed).not.toBe(before);

    // The same members in a different shape are a different set of orders, and
    // the positions they produce next tick diverge accordingly.
    robot.script.blackboard.formation = { gid: 'g1', type: FormationType.Box };
    expect(worldHash(a.world)).not.toBe(formed);
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
