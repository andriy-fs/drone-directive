import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '../../types/enums';
import { spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { droneSystem } from './drone';
import { makeCtx } from './testkit';

function fillNav(ctx: GameContext, blocked: boolean): void {
  const { width, height } = gameConfig.grid;
  ctx.navObstacles = Array.from({ length: height }, () => new Array<boolean>(width).fill(blocked));
}

function setControl(
  ctx: GameContext,
  dir = { x: 0, y: 0 },
  possessPulse = false,
  firePulse = false,
): void {
  ctx.droneControl = { dir, possessPulse, firePulse };
}

describe('droneSystem — free flight', () => {
  it('flies straight through obstacles (never pathfinds)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true); // whole map "blocked" — must not matter to the drone
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(drone.position!.x).toBeCloseTo(400 + gameConfig.drone.speed, 3);
    expect(drone.position!.y).toBeCloseTo(400, 3);
  });

  it('clamps to the world bounds', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 10, y: 10 });
    setControl(ctx, { x: -1, y: -1 });
    droneSystem(ctx, 1);
    expect(drone.position!.x).toBe(0);
    expect(drone.position!.y).toBe(0);
  });

  it('consumes the one-shot pulses each tick', () => {
    const ctx = makeCtx(1);
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true, true);
    droneSystem(ctx, 1);
    expect(ctx.droneControl.possessPulse).toBe(false);
    expect(ctx.droneControl.firePulse).toBe(false);
  });
});

describe('droneSystem — possession', () => {
  it('lands on the nearest idle friendly robot within range', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 405, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBe(robot.id);
  });

  it('will not possess a non-idle robot', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.script!.programId = TaskType.Guard;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });

  it('will not possess an idle robot out of range', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, {
      x: 400 + gameConfig.drone.possessRadius + 20,
      y: 400,
    });
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });

  it('releases the robot on the next possess pulse and stays put', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 0, y: 0 }, true);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
    expect(drone.position!.x).toBeCloseTo(400, 3);
  });

  it('frees itself when the possessed robot dies', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    robot.hp = 0;
    setControl(ctx);

    droneSystem(ctx, 1);

    expect(drone.drone!.possessedId).toBeUndefined();
  });
});

describe('droneSystem — driving a possessed robot', () => {
  it('steers the robot and drags the drone along', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false); // open ground
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(robot.position!.x).toBeGreaterThan(400);
    expect(drone.position!.x).toBeCloseTo(robot.position!.x, 3);
    expect(drone.position!.y).toBeCloseTo(robot.position!.y, 3);
  });

  it('stops the possessed robot at walls (obstacle-checked)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, true); // every destination tile blocked
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx, { x: 1, y: 0 });

    droneSystem(ctx, 1);

    expect(robot.position!.x).toBeCloseTo(400, 3); // did not phase through the wall
  });

  it('keeps a possessed robot from auto-firing (clears its target)', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.targetId = 'someEnemy';
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = robot.id;
    setControl(ctx); // no fire pulse

    droneSystem(ctx, 1);

    expect(robot.targetId).toBeUndefined();
  });
});

describe('droneSystem — manual fire', () => {
  it('detonates a possessed kamikaze on demand, damaging a nearby enemy', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Bomb);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 430, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const foeHp = foe.hp!;
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = bomb.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, 1);

    expect(foe.hp!).toBeLessThan(foeHp);
    expect(bomb.hp).toBe(0); // self-destructs
  });

  it('fires a projectile from a possessed gun robot at the nearest enemy in range', () => {
    const ctx = makeCtx(1);
    fillNav(ctx, false);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.AI, { x: 470, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = gun.id;
    setControl(ctx, { x: 0, y: 0 }, false, true);

    droneSystem(ctx, 1);

    expect(ctx.world.with('projectile').entities.length).toBe(1);
    expect(gun.weapon!.cooldownLeft).toBeGreaterThan(0);
  });
});
