import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnDrone, spawnProjectile, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { combatSystem } from './combat';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;

/** Clear the generated terrain so a stray mountain can't absorb the test's shot. */
function openGround(ctx: GameContext): void {
  const { width, height } = gameConfig.grid;
  ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

describe('combatSystem — anti-air', () => {
  it('a missile aimed at a drone brings it down over three hits', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });

    for (let shot = 0; shot < 3; shot++) {
      spawnProjectile(
        ctx.world,
        Owner.AI,
        { x: 390, y: 400 },
        drone.position!,
        drone.id,
        gameConfig.robots.weapons.missiles.damage,
        'shooter',
        WeaponType.Missiles,
      );
      combatSystem(ctx, DT);
    }

    expect(drone.hp).toBeLessThanOrEqual(0);
  });

  it('does not hit a drone the shot merely flies past on its way to a robot', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    const victim = spawnRobot(ctx.world, Owner.Player, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 380, y: 400 },
      victim.position!,
      victim.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );

    // Long enough for the shot to cross the drone's position and reach the robot.
    for (let i = 0; i < 10; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
    expect(victim.hp!).toBeLessThan(victim.maxHp!);
  });

  it('a cannon shot cannot touch a drone even when aimed at one', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.cannon.damage,
      'shooter',
      WeaponType.Cannon,
    );

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });

  it('a drone riding inside a robot is immune — the shot passes it by', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    drone.drone!.possessedId = carrier.id;

    spawnProjectile(
      ctx.world,
      Owner.AI,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );
    combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });

  it('a directed-energy shot cannot touch a drone', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(ctx.world, Owner.AI, { x: 390, y: 400 }, drone.position!, drone.id, 0, 'shooter', WeaponType.Dew);

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
    expect(drone.disabled).toBeUndefined();
  });

  it('leaves a friendly drone alone', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    spawnProjectile(
      ctx.world,
      Owner.Player,
      { x: 390, y: 400 },
      drone.position!,
      drone.id,
      gameConfig.robots.weapons.missiles.damage,
      'shooter',
      WeaponType.Missiles,
    );

    for (let i = 0; i < 5; i++) combatSystem(ctx, DT);

    expect(drone.hp).toBe(gameConfig.drone.maxHp);
  });
});

const DEW = gameConfig.robots.weapons.dew;

/** Runs the system until `done()` holds, or fails the test after `ticks` steps. */
function runUntil(ctx: GameContext, done: () => boolean, ticks = 30): void {
  for (let i = 0; i < ticks && !done(); i++) combatSystem(ctx, DT);
  expect(done()).toBe(true);
}

describe('combatSystem — directed-energy weapon', () => {
  it('fires even though it deals no damage', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;

    combatSystem(ctx, DT);

    expect(ctx.world.with('projectile').entities.length).toBe(1);
    expect(shooter.weapon!.cooldownLeft).toBe(DEW.cooldown);
  });

  it('disables the robot it hits instead of hurting it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    shooter.targetId = foe.id;

    runUntil(ctx, () => foe.disabled !== undefined);

    expect(foe.disabled!.left).toBe(DEW.freezeDuration);
    expect(foe.hp).toBe(foe.maxHp);
  });

  it('a second hit extends the knock-out rather than stacking it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    for (let i = 0; i < 2; i++) {
      spawnProjectile(ctx.world, Owner.Player, { x: 400, y: 400 }, foe.position!, foe.id, 0, 'shooter', WeaponType.Dew);
    }

    runUntil(ctx, () => foe.disabled !== undefined);

    expect(foe.disabled!.left).toBe(DEW.freezeDuration);
  });

  it('flies over an enemy base rather than being absorbed by it', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const from = { x: base.position!.x - 120, y: base.position!.y };
    spawnProjectile(ctx.world, Owner.Player, from, base.position!, base.id, 0, 'shooter', WeaponType.Dew);

    for (let i = 0; i < 30; i++) combatSystem(ctx, DT);

    expect(base.hp).toBe(base.maxHp);
  });

  it('a disabled robot neither fires nor reloads', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const shooter = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Radar);
    shooter.targetId = foe.id;
    shooter.weapon!.cooldownLeft = 0.5;
    shooter.disabled = { left: 2 };

    for (let i = 0; i < 10; i++) combatSystem(ctx, DT);

    expect(ctx.world.with('projectile').entities.length).toBe(0);
    expect(shooter.weapon!.cooldownLeft).toBe(0.5);
  });
});
