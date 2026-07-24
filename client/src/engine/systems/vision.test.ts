import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, WeaponType } from '../../types/enums';
import { spawnBase, spawnDrone, spawnRobot } from '../ecs/factory';
import { makeCtx } from './testkit';
import { visionSystem } from './vision';

describe('visionSystem — detection (no omniscience)', () => {
  it('does not know a distant enemy robot', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 1200, y: 1200 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(false);
  });

  it('spots an enemy robot once within an ally sight range', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 120, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
  });

  it('forgets an enemy robot once no ally can see it (real-time, no memory)', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 120, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
    foe.position!.x = 5000;
    foe.position!.y = 5000;
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(false);
  });

  it('keeps a discovered enemy base known permanently (bases do not move)', () => {
    const ctx = makeCtx(1);
    const enemyBase = spawnBase(ctx.world, Owner.AI, 33, 4);
    const scout = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: enemyBase.position!.x - 30, y: enemyBase.position!.y },
      ChassisType.Wheels,
      WeaponType.None,
    );
    visionSystem(ctx);
    expect(ctx.intel.player.knownBaseIds.has(enemyBase.id)).toBe(true);

    scout.position!.x = 50;
    scout.position!.y = 50;
    visionSystem(ctx);
    expect(ctx.intel.player.knownBaseIds.has(enemyBase.id)).toBe(true);
  });

  it('a base grants its own vision, with no ally robot nearby', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const foe = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 100, y: base.position!.y },
      ChassisType.Legs,
      WeaponType.Cannon,
    );
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
  });

  it('assigns per-chassis / base sight ranges from config', () => {
    const ctx = makeCtx(1);
    const tracks = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const wheels = spawnRobot(ctx.world, Owner.Player, { x: 90, y: 50 }, ChassisType.Wheels, WeaponType.None);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    expect(tracks.sightRange).toBe(gameConfig.robots.chassis.tracks.sight);
    expect(wheels.sightRange).toBe(gameConfig.robots.chassis.wheels.sight);
    expect(base.sightRange).toBe(gameConfig.bases.sightRange);
  });

  it('the observer drone spots enemies on its own (additive scout)', () => {
    const ctx = makeCtx(1);
    // No player robots or base — only the drone can reveal.
    spawnDrone(ctx.world, Owner.Player, { x: 400, y: 400 });
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
  });

  it('radar weapon doubles the chassis sight range', () => {
    const ctx = makeCtx(1);
    const plain = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Wheels, WeaponType.Cannon);
    const radar = spawnRobot(ctx.world, Owner.Player, { x: 90, y: 50 }, ChassisType.Wheels, WeaponType.Radar);
    expect(radar.sightRange).toBe(plain.sightRange! * gameConfig.robots.weapons.radar.sightMultiplier);
  });
});

describe('visionSystem — ew jamming', () => {
  it('an enemy ew robot halves a scout effective sight range', () => {
    const ctx = makeCtx(1);
    // Tracks sight is 190px: 100px away would be spotted unjammed, but not at half (95px).
    spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.None);
    spawnRobot(ctx.world, Owner.AI, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Ew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 100, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(false);
  });

  it('does not jam once the ew robot is outside jamRadius', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.None);
    spawnRobot(ctx.world, Owner.AI, { x: 1000, y: 1000 }, ChassisType.Tracks, WeaponType.Ew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 100, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
  });

  it('a dead ew robot no longer jams', () => {
    const ctx = makeCtx(1);
    spawnRobot(ctx.world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.None);
    const jammer = spawnRobot(ctx.world, Owner.AI, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Ew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 100, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);
    jammer.hp = 0;
    visionSystem(ctx);
    expect(ctx.intel.player.visibleRobotIds.has(foe.id)).toBe(true);
  });
});
