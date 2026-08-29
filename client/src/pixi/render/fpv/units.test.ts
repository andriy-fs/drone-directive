import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnRobot } from '../../../engine/ecs/factory';
import { createEcsWorld } from '../../../engine/ecs/world';
import { baseHeat, robotHeat } from './units';

/**
 * Heat is the one thing this file computes rather than draws: two numbers the
 * simulation already holds, read straight. The shapes they are drawn onto are
 * `client/src/models/`'s business and are tested there.
 */

describe('heat', () => {
  const world = createEcsWorld();
  const robot = () => spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);

  it('is cold on a machine that is parked and loaded', () => {
    expect(robotHeat(robot())).toEqual({ drive: 0, barrel: 0 });
  });

  it('reads a just-fired gun as hot and a cooling one as fading', () => {
    const r = robot();
    r.weapon.cooldownLeft = r.weapon.cooldown;
    expect(robotHeat(r).barrel).toBe(1);
    r.weapon.cooldownLeft = r.weapon.cooldown / 4;
    expect(robotHeat(r).barrel).toBeCloseTo(0.25, 5);
    r.weapon.cooldownLeft = 0;
    expect(robotHeat(r).barrel).toBe(0);
  });

  it('never lights a weapon that cannot fire', () => {
    // A radar's cooldown is zero, and dividing by it would leave every scout in
    // the game glowing permanently.
    const scout = spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Wheels, WeaponType.Radar);
    scout.weapon.cooldownLeft = 3;
    expect(robotHeat(scout).barrel).toBe(0);
  });

  it('reads the drive against what the chassis can actually do', () => {
    const r = robot();
    r.movement.velX = r.movement.speed;
    expect(robotHeat(r).drive).toBe(1);
    r.movement.velX = r.movement.speed / 2;
    expect(robotHeat(r).drive).toBeCloseTo(0.5, 5);
    // Diagonal travel is the same ground speed, not 1.4× of it.
    const half = (r.movement.speed / 2) * Math.SQRT1_2;
    r.movement.velX = half;
    r.movement.velY = half;
    expect(robotHeat(r).drive).toBeCloseTo(0.5, 5);
  });

  it('clamps a hull shoved past its own top speed', () => {
    // `separationSystem` can push a hull further than it drove itself, and an
    // alpha above 1 is a stroke Pixi silently clamps — better to clamp it here.
    const r = robot();
    r.movement.velX = r.movement.speed * 3;
    expect(robotHeat(r).drive).toBe(1);
  });

  it('gives a base a barrel but no drive', () => {
    const base = { weapon: { cooldown: 4, cooldownLeft: 2 } };
    expect(baseHeat(base as Parameters<typeof baseHeat>[0])).toEqual({ drive: 0, barrel: 0.5 });
  });
});
