import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '../../types/enums';
import { spawnDrone, spawnProjectile, spawnRobot } from '../ecs/factory';
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
