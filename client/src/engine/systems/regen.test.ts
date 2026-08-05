import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnDrone, spawnProjectile, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { combatSystem, detonateBomb } from './combat';
import { regenSystem } from './regen';
import { applyDisable } from './status';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;
const ROBOT_RATE = gameConfig.robots.regenPerSecond;
const BASE_RATE = gameConfig.bases.regenPerSecond;

/** Clear the generated terrain so a stray mountain can't absorb the test's shot. */
function openGround(ctx: GameContext): void {
  const { width, height } = gameConfig.grid;
  ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

/** Runs the regen system for `seconds` of fixed steps. */
function run(ctx: GameContext, seconds: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) regenSystem(ctx, DT);
}

describe('regenSystem — rates', () => {
  it('repairs a damaged robot at the robot rate', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.hp = 50;

    run(ctx, 1);

    expect(robot.hp).toBeCloseTo(50 + ROBOT_RATE, 6);
  });

  it('repairs a damaged base twice as fast as a robot', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 4);
    base.hp = 100;

    run(ctx, 1);

    expect(base.hp).toBeCloseTo(100 + BASE_RATE, 6);
    expect(BASE_RATE).toBeCloseTo(ROBOT_RATE * 2, 6);
  });

  it('never repairs past maxHp', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Cannon);
    robot.hp = robot.maxHp! - 0.1;

    run(ctx, 5);

    expect(robot.hp).toBe(robot.maxHp);
  });

  it('leaves a dead hull at zero — repair cannot outrun the reaper', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.hp = 0;

    run(ctx, 10);

    expect(robot.hp).toBe(0);
  });

  it('repairs a robot knocked out by a directed-energy hit', () => {
    const ctx = makeCtx(1);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.hp = 50;
    applyDisable(robot, 5);

    run(ctx, 1);

    expect(robot.hp).toBeCloseTo(50 + ROBOT_RATE, 6);
  });

  it('does not repair the observer drone — it is replaced, not mended', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.hp = 20;

    run(ctx, 10);

    expect(drone.hp).toBe(20);
  });
});

describe('regenSystem — suspended by damage', () => {
  it('a hit robot stays at its damaged hp for regenDelay, then mends', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const robot = spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Legs, WeaponType.Cannon);
    spawnProjectile(
      ctx.world,
      Owner.Player,
      { x: 390, y: 400 },
      robot.position!,
      robot.id,
      gameConfig.robots.weapons.cannon.damage,
      'shooter',
      WeaponType.Cannon,
    );

    // Land the shot; the combat step also advances the world by one tick.
    for (let i = 0; i < 5; i++) {
      combatSystem(ctx, DT);
      regenSystem(ctx, DT);
    }
    const damaged = robot.hp!;
    expect(damaged).toBeLessThan(robot.maxHp!);

    run(ctx, gameConfig.combat.regenDelay - 1);
    expect(robot.hp).toBe(damaged);

    run(ctx, 2);
    expect(robot.hp).toBeGreaterThan(damaged);
  });

  it('a shelled base stops repairing too, even though it has no threat memory', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 4, 4);
    base.hp = 100;
    const from = { x: base.position!.x - 60, y: base.position!.y };
    spawnProjectile(
      ctx.world,
      Owner.Player,
      from,
      base.position!,
      base.id,
      gameConfig.robots.weapons.cannon.damage,
      'shooter',
      WeaponType.Cannon,
    );

    for (let i = 0; i < 5; i++) {
      combatSystem(ctx, DT);
      regenSystem(ctx, DT);
    }
    const damaged = base.hp!;
    expect(damaged).toBeLessThan(100);
    expect(base.threat).toBeUndefined();

    run(ctx, gameConfig.combat.regenDelay - 1);
    expect(base.hp).toBe(damaged);

    run(ctx, 2);
    expect(base.hp).toBeGreaterThan(damaged);
  });

  it('a kamikaze blast suspends repair on everything it catches', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 4, 4);
    base.hp = 400;
    const victim = spawnRobot(ctx.world, Owner.AI, base.position!, ChassisType.Legs, WeaponType.Cannon);
    victim.hp = 100;
    const bomb = spawnRobot(ctx.world, Owner.Player, base.position!, ChassisType.Wheels, WeaponType.Bomb);

    detonateBomb(ctx, bomb);
    const baseHp = base.hp!;
    const victimHp = victim.hp!;

    run(ctx, gameConfig.combat.regenDelay - 1);

    expect(base.hp).toBe(baseHp);
    expect(victim.hp).toBe(victimHp);
  });
});
