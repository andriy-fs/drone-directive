import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { fogSystem } from './fog';
import { makeCtx } from './testkit';

const { tilePx } = gameConfig.grid;

function tileAt(x: number, y: number): { tx: number; ty: number } {
  return { tx: Math.floor(x / tilePx), ty: Math.floor(y / tilePx) };
}

function visibleAt(ctx: GameContext, x: number, y: number): boolean {
  const { tx, ty } = tileAt(x, y);
  return ctx.fog.visible[ty][tx];
}

function exploredAt(ctx: GameContext, x: number, y: number): boolean {
  const { tx, ty } = tileAt(x, y);
  return ctx.fog.explored[ty][tx];
}

describe('fogSystem — drone-driven reveal', () => {
  it('reveals tiles under the drone and leaves distant tiles hidden', () => {
    const ctx = makeCtx(1);
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });

    fogSystem(ctx);

    expect(visibleAt(ctx, 400, 400)).toBe(true);
    expect(exploredAt(ctx, 400, 400)).toBe(true);
    expect(visibleAt(ctx, 1200, 1200)).toBe(false);
    expect(exploredAt(ctx, 1200, 1200)).toBe(false);
  });

  it('remembers explored ground after the drone moves on (explored persists, visible does not)', () => {
    const ctx = makeCtx(1);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    fogSystem(ctx);
    expect(visibleAt(ctx, 400, 400)).toBe(true);

    drone.position!.x = 1000;
    drone.position!.y = 1000;
    fogSystem(ctx);

    expect(visibleAt(ctx, 400, 400)).toBe(false); // no longer in sight
    expect(exploredAt(ctx, 400, 400)).toBe(true); // but still remembered
    expect(visibleAt(ctx, 1000, 1000)).toBe(true); // new area now visible
  });

  it('robots and bases reveal too (additive to the drone)', () => {
    const ctx = makeCtx(1);
    spawnDrone(ctx.world, Owner.Player, { x: 200, y: 200 });
    spawnRobot(ctx.world, Owner.Player, { x: 900, y: 900 }, ChassisType.Tracks, WeaponType.Cannon);

    fogSystem(ctx);

    expect(visibleAt(ctx, 200, 200)).toBe(true); // drone
    expect(visibleAt(ctx, 900, 900)).toBe(true); // robot
  });

  it('bumps version on change, but not when nothing changed', () => {
    const ctx = makeCtx(1);
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });

    const v0 = ctx.fog.version;
    fogSystem(ctx);
    expect(ctx.fog.version).toBeGreaterThan(v0); // first reveal

    const v1 = ctx.fog.version;
    fogSystem(ctx); // drone hasn't moved
    expect(ctx.fog.version).toBe(v1);
  });
});

describe('fogSystem — ew jamming', () => {
  it('an enemy ew robot halves the reveal radius of a nearby scout', () => {
    const ctx = makeCtx(1);
    // Tracks sight is 190px: 170px away would be revealed unjammed, but not at half (95px).
    spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.None);
    spawnRobot(ctx.world, Owner.AI, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Ew);

    fogSystem(ctx);

    expect(visibleAt(ctx, 400 + 170, 400)).toBe(false);
  });

  it('does not jam once the ew robot is outside jamRadius', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.None);
    spawnRobot(ctx.world, Owner.AI, { x: 1400, y: 1400 }, ChassisType.Tracks, WeaponType.Ew);

    fogSystem(ctx);

    expect(visibleAt(ctx, 400 + 170, 400)).toBe(true);
  });
});

describe('fogSystem — a possessed hull', () => {
  /** Puts `owner`'s drone inside `robot`, the way `droneSystem` does on an `F` press. */
  const possess = (drone: { drone: { possessedId?: string } }, robot: { id: string }) => {
    drone.drone.possessedId = robot.id;
  };

  it('reveals the sector the hull is facing and nothing behind it', () => {
    const ctx = makeCtx(1);
    // Facing east. Tracks sight is 190 px, so 150 px out is inside the range either
    // way — the only thing under test is which side of the hull it is on.
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Tracks, WeaponType.None);
    hull.heading = 0;
    possess(spawnDrone(ctx.world, Owner.Player, { x: 600, y: 600 }), hull);

    fogSystem(ctx);

    expect(visibleAt(ctx, 600 + 150, 600)).toBe(true);
    expect(visibleAt(ctx, 600 - 150, 600)).toBe(false);
  });

  it('turns the sector with the hull', () => {
    const ctx = makeCtx(1);
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Tracks, WeaponType.None);
    hull.heading = Math.PI; // west
    possess(spawnDrone(ctx.world, Owner.Player, { x: 600, y: 600 }), hull);

    fogSystem(ctx);

    expect(visibleAt(ctx, 600 - 150, 600)).toBe(true);
    expect(visibleAt(ctx, 600 + 150, 600)).toBe(false);
  });

  it('leaves an unpossessed hull seeing all the way round', () => {
    const ctx = makeCtx(1);
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Tracks, WeaponType.None);
    hull.heading = 0;

    fogSystem(ctx);

    expect(visibleAt(ctx, 600 + 150, 600)).toBe(true);
    expect(visibleAt(ctx, 600 - 150, 600)).toBe(true);
  });

  it('stops the ridden drone revealing anything of its own', () => {
    const ctx = makeCtx(1);
    // The hull is deliberately blind, so anything revealed here came from the drone
    // sitting on it — which is the free scouting this is meant to end.
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Tracks, WeaponType.None);
    hull.sightRange = 0;
    hull.heading = 0;
    possess(spawnDrone(ctx.world, Owner.Player, { x: 600, y: 600 }), hull);

    fogSystem(ctx);

    expect(visibleAt(ctx, 600, 600)).toBe(false);
  });
});
