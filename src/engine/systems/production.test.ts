import { describe, expect, it } from 'vitest';
import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import { BuildPresetType, ChassisType, Owner, TaskType, WeaponType } from '../../types/enums';
import type { Entity } from '../ecs/entity';
import { spawnBase, spawnDrone, spawnRobot } from '../ecs/factory';
import { commandsSystem } from './commands';
import { productionSystem } from './production';
import { makeCtx } from './testkit';
import type { GameContext } from '../game/context';

/** Finish one queued/auto build and return the freshly produced robot. */
function buildOne(ctx: GameContext, base: Entity): Entity {
  base.production!.progress = 0.999;
  productionSystem(ctx, 1000);
  return ctx.world.with('robot').entities.at(-1)!;
}

describe('productionSystem — program resolution', () => {
  it('uses the order.task when the build order specifies one', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.Guard;
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon, task: TaskType.AttackRobots });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('forces Idle when order.task is explicitly null (ignores base default)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.Guard;
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon, task: null });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Idle);
  });

  it('falls back to the base default when order.task is unset', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.AttackBase;
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.AttackBase);
  });

  it('stays Idle with neither an order.task nor a base default', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = null;
    base.production!.queue.push({ chassis: ChassisType.Wheels, weapon: WeaponType.Missiles });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Idle);
  });
});

describe('productionSystem — auto-build presets', () => {
  it('the Tracks preset follows the base default program (regression: no forced Idle)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuildPreset = BuildPresetType.Tracks;
    base.production!.defaultTask = TaskType.Guard;
    const robot = buildOne(ctx, base);
    expect(robot.chassis).toBe(ChassisType.Tracks);
    expect(robot.script!.programId).toBe(TaskType.Guard);
  });

  it('a preset step with an explicit task overrides the base default', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuildPreset = BuildPresetType.MixedSquad;
    base.production!.defaultTask = TaskType.Scout;
    const first = getBuildPreset(BuildPresetType.MixedSquad).sequence[0];
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(first.task);
    expect(first.task).not.toBe(TaskType.Scout); // sanity: it's genuinely an override
  });

  it('cycles the sequence and wraps around', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuildPreset = BuildPresetType.TracksWheels;
    const chassis = [buildOne(ctx, base), buildOne(ctx, base), buildOne(ctx, base), buildOne(ctx, base)].map(
      (r) => r.chassis,
    );
    expect(chassis).toEqual([ChassisType.Tracks, ChassisType.Wheels, ChassisType.Wheels, ChassisType.Tracks]);
  });

  it('does not advance the cycle when a step is unaffordable', () => {
    const ctx = makeCtx(1);
    ctx.resources.player = 0;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuildPreset = BuildPresetType.Tracks;
    base.production!.progress = 0.999;
    productionSystem(ctx, 1000);
    expect(base.production!.queue.length).toBe(0);
    expect(base.production!.autoBuildStep).toBe(0);
  });
});

describe('commandsSystem — SetAutoBuild (single-model, order-based)', () => {
  it('sets the auto-build order; produced robots match it', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const order = { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles, task: TaskType.AttackRobots };
    ctx.commands.push({ kind: 'SetAutoBuild', baseId: base.id, order });
    commandsSystem(ctx);
    expect(base.production!.autoBuild).toEqual(order);
    const robot = buildOne(ctx, base);
    expect(robot.chassis).toBe(ChassisType.Wheels);
    expect(robot.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('repeats the same model on every refill', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Legs, weapon: WeaponType.Cannon };
    const chassis = [buildOne(ctx, base), buildOne(ctx, base)].map((r) => r.chassis);
    expect(chassis).toEqual([ChassisType.Legs, ChassisType.Legs]);
  });

  it('clears auto-build when stopped (order null)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    ctx.commands.push({ kind: 'SetAutoBuild', baseId: base.id, order: null });
    commandsSystem(ctx);
    expect(base.production!.autoBuild).toBeNull();
  });
});

describe('per-side robot cap (shared by player and AI)', () => {
  function fillToCap(ctx: GameContext) {
    for (let i = 0; i < gameConfig.production.maxRobots; i++) {
      spawnRobot(ctx.world, Owner.Player, { x: 100 + i * 4, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    }
  }

  it('blocks auto-build refill once the side is at the cap', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    fillToCap(ctx);
    productionSystem(ctx, gameConfig.production.buildTime);
    expect(base.production!.queue.length).toBe(0);
  });

  it('blocks a one-off BuildRobot once the side is at the cap', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    fillToCap(ctx);
    ctx.commands.push({
      kind: 'BuildRobot',
      baseId: base.id,
      order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
    });
    commandsSystem(ctx);
    expect(base.production!.queue.length).toBe(0);
  });

  it('allows building while below the cap', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    ctx.commands.push({
      kind: 'BuildRobot',
      baseId: base.id,
      order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
    });
    commandsSystem(ctx);
    expect(base.production!.queue.length).toBe(1);
  });
});

describe('player auto-build gated by the observer drone (balance)', () => {
  it('suppresses auto-build refill while the drone is away from the base', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    spawnDrone(ctx.world, Owner.Player, { x: 1000, y: 1000 }); // flown clear of the base
    productionSystem(ctx, 0);
    expect(base.production!.queue.length).toBe(0);
  });

  it('resumes auto-build refill once the drone is docked on the base', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    spawnDrone(ctx.world, Owner.Player, { ...base.position! }); // docked on the roof
    productionSystem(ctx, 0);
    expect(base.production!.queue.length).toBe(1);
  });

  it('still allows a manual "build once" while the drone is away', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    spawnDrone(ctx.world, Owner.Player, { x: 1000, y: 1000 });
    ctx.commands.push({
      kind: 'BuildRobot',
      baseId: base.id,
      order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon },
    });
    commandsSystem(ctx);
    expect(base.production!.queue.length).toBe(1);
  });
});
