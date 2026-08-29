import { describe, expect, it } from 'vitest';
import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import { BuildPresetType, ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import type { BuildOrder } from '@drone-directive/types/entities';
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
    base.production!.queue.push({
      chassis: ChassisType.Tracks,
      weapon: WeaponType.Cannon,
      task: TaskType.AttackRobots,
    });
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

  it('refuses an "Attack Robots" order.task for a radar build, spawning Idle instead', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.Guard;
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Radar, task: TaskType.AttackRobots });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Idle);
  });

  it('refuses an "Attack Base" base default for a radar build, spawning Idle instead', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.AttackBase;
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Radar });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Idle);
  });

  it('still allows Overwatch for a radar build', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Radar, task: TaskType.Overwatch });
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Overwatch);
  });
});

describe('productionSystem — rally point', () => {
  const rally = { x: 700, y: 700 };

  /** A base with a rally point set and one queued order of the given program. */
  function baseWithRally(ctx: GameContext, task: TaskType | null, weapon: WeaponType = WeaponType.Cannon): Entity {
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.rally = { ...rally };
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon, task });
    return base;
  }

  it('walks an Idle unit to the rally point', () => {
    const ctx = makeCtx(1);
    const robot = buildOne(ctx, baseWithRally(ctx, null));
    expect(robot.script!.programId).toBe(TaskType.Idle);
    // The goal is snapped to a reachable tile, so compare by proximity.
    expect(robot.movement!.goal).toBeDefined();
    expect(Math.hypot(robot.movement!.goal!.x - rally.x, robot.movement!.goal!.y - rally.y)).toBeLessThan(
      gameConfig.grid.tilePx * 2,
    );
  });

  it('posts a Guard at the rally point rather than at the factory door', () => {
    const ctx = makeCtx(1);
    const base = baseWithRally(ctx, TaskType.Guard);
    const robot = buildOne(ctx, base);
    expect(robot.script!.programId).toBe(TaskType.Guard);
    expect(robot.script!.blackboard.guardPos).toEqual(rally);
    expect(robot.script!.blackboard.guardPos).not.toEqual(base.position);
  });

  it('leaves an attack program alone — its own priority takes over anyway', () => {
    const ctx = makeCtx(1);
    const robot = buildOne(ctx, baseWithRally(ctx, TaskType.AttackBase));
    expect(robot.script!.programId).toBe(TaskType.AttackBase);
    expect(robot.movement!.goal).toBeUndefined();
    expect(robot.script!.blackboard.guardPos).toBeUndefined();
  });

  it('rallies a radar that was refused an attack program and fell back to Idle', () => {
    const ctx = makeCtx(1);
    const robot = buildOne(ctx, baseWithRally(ctx, TaskType.AttackRobots, WeaponType.Radar));
    expect(robot.script!.programId).toBe(TaskType.Idle);
    expect(robot.movement!.goal).toBeDefined();
  });

  it('sends nobody anywhere without a rally point (bots never set one)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 4, 33);
    base.production!.autoBuildPreset = BuildPresetType.Tracks;
    base.production!.defaultTask = TaskType.Guard;
    const robot = buildOne(ctx, base);
    expect(base.production!.rally).toBeNull();
    expect(robot.script!.programId).toBe(TaskType.Guard);
    expect(robot.script!.blackboard.guardPos).toEqual(robot.position);
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

  it('queues an unaffordable step and waits, rather than stalling the cycle', () => {
    // This used to retry the same step until the money arrived. Now that the price
    // is paid at the head of the queue, the refill has nothing left to refuse: the
    // step advances, the order waits, and the pacing is unchanged because a refill
    // only ever happens on an empty queue.
    const ctx = makeCtx(1);
    ctx.resources.player = 0;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    // A multi-step series, so "the cycle moved on" is actually observable — a
    // one-entry preset wraps straight back to 0 and would pass either way.
    base.production!.autoBuildPreset = BuildPresetType.TracksWheels;
    base.production!.progress = 0.999;
    productionSystem(ctx, 1000);
    expect(base.production!.queue.length).toBe(1);
    expect(base.production!.autoBuildStep).toBe(1);
    // Queued, but not begun: no robot, no progress, and nothing spent.
    expect(ctx.world.with('robot').entities.length).toBe(0);
    expect(base.production!.funded).toBe(false);
    expect(ctx.resources.player).toBe(0);
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

describe('commandsSystem — SetDefaultTask', () => {
  it('sets the base directive; a build order without a task of its own inherits it', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    ctx.commands.push({ kind: 'SetDefaultTask', baseId: base.id, task: TaskType.Guard });
    commandsSystem(ctx);
    expect(base.production!.defaultTask).toBe(TaskType.Guard);

    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon });
    expect(buildOne(ctx, base).script!.programId).toBe(TaskType.Guard);
  });

  it('clears the directive when told null — new robots roll out Idle', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.defaultTask = TaskType.Guard;
    ctx.commands.push({ kind: 'SetDefaultTask', baseId: base.id, task: null });
    commandsSystem(ctx);
    expect(base.production!.defaultTask).toBeNull();

    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon });
    expect(buildOne(ctx, base).script!.programId).toBe(TaskType.Idle);
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
      front: false,
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
      front: false,
    });
    commandsSystem(ctx);
    expect(base.production!.queue.length).toBe(1);
  });
});

describe('paying at the head of the queue', () => {
  const cannonTank = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
  const cost = gameConfig.economy.chassisCost.tracks + gameConfig.economy.weaponCost.cannon;

  function order(ctx: GameContext, base: Entity, front = false) {
    ctx.commands.push({ kind: 'BuildRobot', baseId: base.id, order: cannonTank, front });
    commandsSystem(ctx);
  }

  it('takes an order the side cannot pay for, and charges nothing yet', () => {
    // The whole point of the change: a player short of resources states the
    // intent now instead of watching a number climb with a dead button.
    const ctx = makeCtx(1);
    ctx.resources.player = 0;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base);
    expect(base.production!.queue.length).toBe(1);
    expect(ctx.resources.player).toBe(0);
  });

  it('holds the whole queue at zero progress until the head is covered', () => {
    const ctx = makeCtx(1);
    ctx.resources.player = cost - 1;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base);

    productionSystem(ctx, gameConfig.production.buildTime);
    expect(base.production!.funded).toBe(false);
    expect(base.production!.progress).toBe(0);
    expect(ctx.world.with('robot').entities.length).toBe(0);

    // One resource short, then not: the same queue starts on its own.
    ctx.resources.player = cost;
    productionSystem(ctx, gameConfig.production.buildTime / 2);
    expect(base.production!.funded).toBe(true);
    expect(base.production!.progress).toBeGreaterThan(0);
    expect(ctx.resources.player).toBe(0);
  });

  it('charges the price once, not once per tick', () => {
    const ctx = makeCtx(1);
    ctx.resources.player = cost * 3;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base);
    for (let i = 0; i < 5; i++) productionSystem(ctx, gameConfig.production.buildTime / 10);
    expect(ctx.resources.player).toBe(cost * 2);
  });

  it('pays for the next order only when it reaches the front', () => {
    const ctx = makeCtx(1);
    ctx.resources.player = cost;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base);
    order(ctx, base);
    // Enough for one. The first is built and paid for; the second waits its turn
    // rather than being refused at the door.
    productionSystem(ctx, gameConfig.production.buildTime);
    expect(ctx.world.with('robot').entities.length).toBe(1);
    expect(base.production!.queue.length).toBe(1);
    expect(base.production!.funded).toBe(false);
    expect(ctx.resources.player).toBe(0);
  });
});

describe('jumping the queue', () => {
  const tank = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
  const buggy = { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles };

  function order(ctx: GameContext, base: Entity, o: BuildOrder, front: boolean) {
    ctx.commands.push({ kind: 'BuildRobot', baseId: base.id, order: o, front });
    commandsSystem(ctx);
  }

  it('goes to the front while nothing has started', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank, false);
    order(ctx, base, buggy, true);
    expect(base.production!.queue.map((o) => o.chassis)).toEqual([ChassisType.Wheels, ChassisType.Tracks]);
  });

  it('goes second once the head has been paid for and started', () => {
    // Displacing a funded order would hand the player a different machine on
    // someone else's progress and someone else's money.
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank, false);
    productionSystem(ctx, gameConfig.production.buildTime / 4);
    expect(base.production!.funded).toBe(true);

    order(ctx, base, buggy, true);
    expect(base.production!.queue.map((o) => o.chassis)).toEqual([ChassisType.Tracks, ChassisType.Wheels]);
    // And the tank keeps the progress it had.
    expect(base.production!.progress).toBeGreaterThan(0);
  });

  it('still joins the back when it is not a jump', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank, false);
    order(ctx, base, buggy, false);
    expect(base.production!.queue.map((o) => o.chassis)).toEqual([ChassisType.Tracks, ChassisType.Wheels]);
  });
});

describe('taking an order back off the queue', () => {
  const tank = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
  const buggy = { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles };
  const cost = (o: BuildOrder) =>
    gameConfig.economy.chassisCost[o.chassis] + gameConfig.economy.weaponCost[o.weapon];

  function order(ctx: GameContext, base: Entity, o: BuildOrder) {
    ctx.commands.push({ kind: 'BuildRobot', baseId: base.id, order: o, front: false });
    commandsSystem(ctx);
  }
  function cancel(ctx: GameContext, base: Entity, index: number, o: BuildOrder) {
    ctx.commands.push({ kind: 'CancelQueued', baseId: base.id, index, order: o });
    commandsSystem(ctx);
  }

  it('removes the order at the position given', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    order(ctx, base, buggy);
    cancel(ctx, base, 1, buggy);
    expect(base.production!.queue.map((o) => o.chassis)).toEqual([ChassisType.Tracks]);
  });

  it('charges nothing back for an order that was never paid for', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    order(ctx, base, buggy);
    productionSystem(ctx, gameConfig.production.buildTime / 4); // pays for the head only
    const before = ctx.resources.player;
    cancel(ctx, base, 1, buggy);
    expect(ctx.resources.player).toBe(before);
  });

  it('refunds the order it was building, and stops the clock', () => {
    const ctx = makeCtx(1);
    // A balance a real match could hold: the testkit's is far past the economy's
    // own ceiling, where the refund below is legitimately clamped.
    ctx.resources.player = 500;
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    productionSystem(ctx, gameConfig.production.buildTime / 4);
    const paid = ctx.resources.player;
    expect(base.production!.funded).toBe(true);

    cancel(ctx, base, 0, tank);
    expect(ctx.resources.player).toBe(paid + cost(tank));
    expect(base.production!.funded).toBe(false);
    expect(base.production!.progress).toBe(0);
  });

  it('never refunds past the ceiling the economy itself has', () => {
    // Otherwise queue-and-cancel banks without limit: pay at the cap, let income
    // fill the hole back up, cancel, and repeat for as much as you like.
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    productionSystem(ctx, gameConfig.production.buildTime / 4);
    ctx.resources.player = gameConfig.economy.maxResources;
    cancel(ctx, base, 0, tank);
    expect(ctx.resources.player).toBe(gameConfig.economy.maxResources);
  });

  it('finds the order by value when the queue has moved under the click', () => {
    // A build finishing between the snapshot the dialog drew and this tick slides
    // everything up by one; the position is stale but what the player meant is not.
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    order(ctx, base, buggy);
    productionSystem(ctx, gameConfig.production.buildTime); // the tank rolls out
    expect(base.production!.queue.map((o) => o.chassis)).toEqual([ChassisType.Wheels]);
    // The player clicked slot 1, which is now empty — the buggy moved to slot 0.
    cancel(ctx, base, 1, buggy);
    expect(base.production!.queue).toEqual([]);
  });

  it('does nothing when the order named is no longer anywhere in the queue', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    order(ctx, base, tank);
    cancel(ctx, base, 0, buggy);
    expect(base.production!.queue).toHaveLength(1);
  });
});

describe('auto-build runs regardless of where the observer drone is', () => {
  it('keeps refilling the queue while the drone is away from the base', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    base.production!.autoBuild = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    spawnDrone(ctx.world, Owner.Player, { x: 1000, y: 1000 }); // flown clear of the base
    productionSystem(ctx, 0);
    expect(base.production!.queue.length).toBe(1);
  });
});
