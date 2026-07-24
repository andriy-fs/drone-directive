import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '../../types/enums';
import { distance } from '../../utils/math';
import { spawnRobot } from '../ecs/factory';
import { makeCtx } from './testkit';
import { separationSystem } from './separation';

const MIN_DIST = gameConfig.robots.radius * 2;

describe('separationSystem — robots never share coordinates', () => {
  it('pushes exactly-coincident robots apart to the collision distance', () => {
    const ctx = makeCtx(1);
    const a = spawnRobot(ctx.world, Owner.Player, { x: 300, y: 300 }, ChassisType.Tracks, WeaponType.Cannon);
    const b = spawnRobot(ctx.world, Owner.Player, { x: 300, y: 300 }, ChassisType.Wheels, WeaponType.Missiles);
    expect(distance(a.position!.x, a.position!.y, b.position!.x, b.position!.y)).toBe(0);
    separationSystem(ctx);
    expect(distance(a.position!.x, a.position!.y, b.position!.x, b.position!.y)).toBeGreaterThanOrEqual(
      MIN_DIST - 1e-6,
    );
  });

  it('resolves partially-overlapping robots to exactly the collision distance', () => {
    const ctx = makeCtx(1);
    const a = spawnRobot(ctx.world, Owner.Player, { x: 300, y: 300 }, ChassisType.Tracks, WeaponType.Cannon);
    const b = spawnRobot(ctx.world, Owner.Player, { x: 308, y: 300 }, ChassisType.Wheels, WeaponType.Missiles);
    separationSystem(ctx);
    expect(distance(a.position!.x, a.position!.y, b.position!.x, b.position!.y)).toBeCloseTo(MIN_DIST, 5);
  });

  it('leaves already-spaced robots untouched', () => {
    const ctx = makeCtx(1);
    const a = spawnRobot(ctx.world, Owner.Player, { x: 300, y: 300 }, ChassisType.Tracks, WeaponType.Cannon);
    const b = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 300 }, ChassisType.Wheels, WeaponType.Missiles);
    separationSystem(ctx);
    expect([a.position!.x, b.position!.x]).toEqual([300, 400]);
  });
});
