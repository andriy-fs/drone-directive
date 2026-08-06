import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnRobot } from '../../engine/ecs/factory';
import type { GameContext } from '../../engine/game/context';
import { makeCtx } from '../../engine/systems/testkit';
import { enemyAt, selectionCanAttack } from './hitTest';

/** An `Owner.Player` robot with the given weapon, parked away from anything else. */
function ally(ctx: GameContext, weapon: WeaponType) {
  return spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, weapon);
}

describe('enemyAt', () => {
  it('picks the enemy robot under the point and ignores the player’s own', () => {
    const ctx = makeCtx();
    const mine = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    const theirs = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    expect(enemyAt(ctx, { x: 400, y: 400 }, Owner.Player)?.id).toBe(theirs.id);
    expect(enemyAt(ctx, mine.position!, Owner.Player)).toBeUndefined();
    expect(enemyAt(ctx, { x: 600, y: 600 }, Owner.Player)).toBeUndefined();
  });

  it('falls through to an enemy base footprint, and skips a dead one', () => {
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.AI, 4, 4);
    expect(enemyAt(ctx, base.position!, Owner.Player)?.id).toBe(base.id);

    base.hp = 0;
    expect(enemyAt(ctx, base.position!, Owner.Player)).toBeUndefined();
  });
});

describe('selectionCanAttack', () => {
  it('is true for an armed robot against either an enemy robot or an enemy base', () => {
    const ctx = makeCtx();
    const cannon = ally(ctx, WeaponType.Cannon);
    const enemy = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const enemyBase = spawnBase(ctx.world, Owner.AI, 4, 4);

    expect(selectionCanAttack(ctx, [cannon.id], Owner.Player, enemy)).toBe(true);
    expect(selectionCanAttack(ctx, [cannon.id], Owner.Player, enemyBase)).toBe(true);
  });

  it('is false for a radar-only selection — no reach, nothing to hit with', () => {
    const ctx = makeCtx();
    const radar = ally(ctx, WeaponType.Radar);
    const enemy = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    expect(selectionCanAttack(ctx, [radar.id], Owner.Player, enemy)).toBe(false);
  });

  it('lets a dew freeze an enemy robot but not a base it cannot damage', () => {
    const ctx = makeCtx();
    const dew = ally(ctx, WeaponType.Dew);
    const enemy = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const enemyBase = spawnBase(ctx.world, Owner.AI, 4, 4);

    expect(selectionCanAttack(ctx, [dew.id], Owner.Player, enemy)).toBe(true);
    expect(selectionCanAttack(ctx, [dew.id], Owner.Player, enemyBase)).toBe(false);
  });

  it('needs only one able robot in a mixed selection', () => {
    const ctx = makeCtx();
    const radar = ally(ctx, WeaponType.Radar);
    const cannon = ally(ctx, WeaponType.Cannon);
    const enemy = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    expect(selectionCanAttack(ctx, [radar.id, cannon.id], Owner.Player, enemy)).toBe(true);
  });

  it('ignores dead, foreign and unknown ids, and an empty selection', () => {
    const ctx = makeCtx();
    const dead = ally(ctx, WeaponType.Cannon);
    dead.hp = 0;
    const notOurs = spawnRobot(ctx.world, Owner.AI, { x: 300, y: 300 }, ChassisType.Tracks, WeaponType.Cannon);
    const enemy = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    expect(selectionCanAttack(ctx, [dead.id], Owner.Player, enemy)).toBe(false);
    expect(selectionCanAttack(ctx, [notOurs.id], Owner.Player, enemy)).toBe(false);
    expect(selectionCanAttack(ctx, ['robot_nope'], Owner.Player, enemy)).toBe(false);
    expect(selectionCanAttack(ctx, [], Owner.Player, enemy)).toBe(false);
  });
});
