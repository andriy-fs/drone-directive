import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { refreshNavObstacles } from '../navGrid';
import { isBlockedGrid, tileOf } from '../obstacles';
import { findPath } from '../pathfinding';
import { makeAttackBase } from '../tasks/taskDefinitions';
import { makeCtx } from './testkit';
import { movementSystem } from './movement';

describe('base as a movement obstacle', () => {
  it('blocks its footprint in the nav grid but not in the terrain/LOS grid', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    refreshNavObstacles(ctx);
    const c = tileOf(base.position!);
    expect(isBlockedGrid(ctx.navObstacles, c.tx, c.ty)).toBe(true);
    expect(isBlockedGrid(ctx.obstacles, c.tx, c.ty)).toBe(false);
  });

  it('snaps a goal inside the base out to a passable tile (robots stop outside)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    refreshNavObstacles(ctx);
    const path = findPath(ctx.navObstacles, { x: 48, y: base.position!.y }, base.position!);
    expect(path.length).toBeGreaterThan(0);
    const last = tileOf(path[path.length - 1]);
    expect(isBlockedGrid(ctx.navObstacles, last.tx, last.ty)).toBe(false);
  });

  it('escapes a blocked start (robot shoved inside the base) instead of freezing', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    refreshNavObstacles(ctx);
    const inside = tileOf(base.position!);
    expect(isBlockedGrid(ctx.navObstacles, inside.tx, inside.ty)).toBe(true);

    // From dead-center of the footprint (all neighbours blocked) to a far point.
    const path = findPath(ctx.navObstacles, base.position!, { x: 1000, y: 1000 });
    expect(path.length).toBeGreaterThan(0); // not stuck
    const firstTile = tileOf(path[0]);
    expect(isBlockedGrid(ctx.navObstacles, firstTile.tx, firstTile.ty)).toBe(false); // steps onto open ground
  });

  it('reopens the footprint once the base is destroyed', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    refreshNavObstacles(ctx);
    const c = tileOf(base.position!);
    expect(isBlockedGrid(ctx.navObstacles, c.tx, c.ty)).toBe(true);

    ctx.world.remove(base);
    refreshNavObstacles(ctx);
    expect(isBlockedGrid(ctx.navObstacles, c.tx, c.ty)).toBe(false);
  });
});

describe('movementSystem — anti-jam retreat', () => {
  it('retreats a non-idle robot trapped inside a base back out over time', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const robot = spawnRobot(ctx.world, Owner.AI, { ...base.position! }, ChassisType.Tracks, WeaponType.Cannon);
    robot.script = makeAttackBase(); // a directive, not idle

    const half = (gameConfig.bases.footprintTiles * gameConfig.grid.tilePx) / 2;
    const inside = () =>
      Math.abs(robot.position!.x - base.position!.x) < half && Math.abs(robot.position!.y - base.position!.y) < half;
    expect(inside()).toBe(true);

    for (let i = 0; i < 150; i++) movementSystem(ctx, gameConfig.fixedDt);
    expect(inside()).toBe(false); // reversed out of the footprint
  });

  it('leaves a parked idle robot inside a base alone (no goal → no retreat)', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const robot = spawnRobot(ctx.world, Owner.AI, { ...base.position! }, ChassisType.Tracks, WeaponType.Cannon);
    // default script is Idle
    const start = { x: robot.position!.x, y: robot.position!.y };
    for (let i = 0; i < 60; i++) movementSystem(ctx, gameConfig.fixedDt);
    expect(robot.position).toEqual(start); // untouched
  });

  it('retreats an idle robot that has been *sent* somewhere and makes no progress', () => {
    // An Idle unit with a goal is a real case now: a right-click move, or a
    // whole production run funnelling out to a rally point. A goal it cannot
    // path to leaves it with no destination to walk toward — exactly the jam.
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    expect(robot.script!.programId).toBe(TaskType.Idle);
    robot.movement!.goal = { x: 900, y: 900 };
    robot.movement!.destination = undefined;

    const ticks = Math.ceil(gameConfig.behavior.stuckAfter / gameConfig.fixedDt) + 2;
    for (let i = 0; i < ticks; i++) movementSystem(ctx, gameConfig.fixedDt);
    expect(robot.movement!.retreatTime).toBeGreaterThan(0);
  });
});

describe('movementSystem — disabled robots', () => {
  it('does not move a robot that has been knocked out, goal or no goal', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.movement!.goal = { x: 900, y: 400 };
    robot.movement!.destination = { x: 900, y: 400 };
    robot.disabled = { left: 8 };
    const start = { ...robot.position! };

    for (let i = 0; i < 60; i++) movementSystem(ctx, gameConfig.fixedDt);

    expect(robot.position).toEqual(start);
  });

  it('does not mistake the standstill for a jam once it recovers', () => {
    // Anti-jam measures net progress against last tick's position. Left stale
    // through the knock-out, eight seconds of standing still would read as a
    // jam and fling the robot backwards the moment it came back.
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.movement!.goal = { x: 900, y: 400 };
    robot.disabled = { left: 8 };

    for (let i = 0; i < 60; i++) movementSystem(ctx, gameConfig.fixedDt);

    expect(robot.movement!.stuckTime).toBe(0);
    expect(robot.movement!.retreatTime ?? 0).toBe(0);
  });
});
