import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '../../types/enums';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { aiSystem } from './ai';
import { productionSystem } from './production';
import { makeCtx } from './testkit';

const aiRobots = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.world.with('robot', 'script').entities.filter((e) => e.owner === Owner.AI);

describe('aiSystem — production preset', () => {
  it('builds the preset in order, with a kamikaze bomb as every 10th unit', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    for (let i = 0; i < 10; i++) {
      aiSystem(ctx, 100); // enqueue one (timer bypassed)
      productionSystem(ctx, 100); // build it
    }
    void base;

    const robots = ctx.world.with('robot').entities.filter((e) => e.owner === Owner.AI);
    expect(robots.length).toBe(10);
    // The first nine are ordinary combat robots...
    expect(robots.slice(0, 9).every((r) => r.weaponType !== WeaponType.Bomb)).toBe(true);
    // ...the tenth is a bomb that rushes the base.
    expect(robots[9].weaponType).toBe(WeaponType.Bomb);
    expect(robots[9].script!.programId).toBe(TaskType.AttackBase);
  });
});

describe('aiSystem — group attacks', () => {
  function seedIdleAi(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    for (let i = 0; i < count; i++) {
      spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x, y: base.position!.y + 40 + i * 4 },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
    }
  }

  it('releases offensive units in a wave once enough have gathered', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0; // starve production so only assignment runs
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai.groupTarget = 3;
    seedIdleAi(ctx, base, gameConfig.ai.guardQuota + 3);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.Guard)).toBe(gameConfig.ai.guardQuota);
    expect(by(TaskType.AttackBase)).toBe(3); // a full wave marched off together
    expect(by(TaskType.Idle)).toBe(0);
  });

  it('holds units back (no attack) until the wave size is reached', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai.groupTarget = 3;
    seedIdleAi(ctx, base, gameConfig.ai.guardQuota + 2); // only 2 staged, below the wave size

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.AttackBase)).toBe(0); // nothing released yet
    expect(by(TaskType.Idle)).toBe(2); // still staged near base
  });

  it('sizes each wave within the configured group range', () => {
    const ctx = makeCtx(3);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai.groupTarget = 0; // force a roll
    seedIdleAi(ctx, base, gameConfig.ai.guardQuota + gameConfig.ai.attackGroupMax);
    ctx.resources.ai = 0;

    aiSystem(ctx, 100);

    const attackers = aiRobots(ctx).filter((r) => r.script!.programId === TaskType.AttackBase).length;
    expect(attackers).toBeGreaterThanOrEqual(gameConfig.ai.attackGroupMin);
    expect(attackers).toBeLessThanOrEqual(gameConfig.ai.attackGroupMax);
  });
});
