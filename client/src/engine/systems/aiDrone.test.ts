import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import type { Vec2 } from '@drone-directive/types/entities';
import { spawnBase, spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { makeAttackBase } from '../tasks/taskDefinitions';
import { pilotDrone } from './aiDrone';
import { droneSystem } from './drone';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;
const BOT = Owner.AI;

/** The bot's base and its drone, parked on the roof exactly as `GameScene` does. */
function stage(seed = 1): { ctx: GameContext; home: Vec2; drone: ReturnType<typeof spawnDrone> } {
  const ctx = makeCtx(seed);
  const base = spawnBase(ctx.world, BOT, 33, 4);
  const drone = spawnDrone(ctx.world, BOT, base.position!);
  return { ctx, home: { ...base.position! }, drone };
}

/** One tick of "bot decides, drone flies" — the same order `GameScene` runs them in. */
function fly(ctx: GameContext, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    pilotDrone(ctx, BOT, ctx.ai[BOT]!);
    droneSystem(ctx, DT);
  }
}

describe('pilotDrone — the bot never lands and never shoots', () => {
  it('leaves both pulses false, whatever it decides to do', () => {
    const { ctx } = stage();
    // An idle friendly robot right under the drone: the one thing that would let
    // a human take the hull. The bot must still fly straight past it.
    const idle = spawnRobot(ctx.world, BOT, { x: 1100, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    idle.script = { programId: TaskType.Idle, blackboard: {} };
    ctx.world.with('drone').entities[0].position = { ...idle.position! };

    for (let i = 0; i < 60; i++) {
      pilotDrone(ctx, BOT, ctx.ai[BOT]!);
      expect(ctx.droneControl[BOT].possessPulse).toBe(false);
      expect(ctx.droneControl[BOT].firePulse).toBe(false);
      droneSystem(ctx, DT);
    }

    expect(ctx.world.with('drone').entities[0].drone!.possessedId).toBeUndefined();
  });
});

describe('pilotDrone — scouting for the push', () => {
  it('flies out ahead of its own advancing group', () => {
    const { ctx, home, drone } = stage();
    const front = { x: home.x - 400, y: home.y + 400 };
    for (let i = 0; i < 3; i++) {
      const r = spawnRobot(ctx.world, BOT, { x: front.x + i * 20, y: front.y }, ChassisType.Tracks, WeaponType.Cannon);
      r.script = makeAttackBase();
    }

    const before = distance(home.x, home.y, drone.position!.x, drone.position!.y);
    fly(ctx, 60);
    const after = distance(home.x, home.y, drone.position!.x, drone.position!.y);

    // It left home, and it is heading past the group rather than trailing it.
    expect(after).toBeGreaterThan(before);
    expect(distance(front.x, front.y, drone.position!.x, drone.position!.y)).toBeLessThan(
      distance(front.x, front.y, home.x, home.y),
    );
  });

  it('sweeps on its own when nothing is advancing', () => {
    const { ctx, home, drone } = stage();

    fly(ctx, 90);

    expect(ctx.ai[BOT]!.droneWaypoint).toBeDefined();
    expect(distance(home.x, home.y, drone.position!.x, drone.position!.y)).toBeGreaterThan(0);
  });
});

describe('pilotDrone — self-preservation', () => {
  it('breaks contact with an enemy surface-to-air robot', () => {
    const { ctx, drone } = stage();
    const aa = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: drone.position!.x - 150, y: drone.position!.y },
      ChassisType.Wheels,
      WeaponType.Missiles,
    );

    const before = distance(aa.position!.x, aa.position!.y, drone.position!.x, drone.position!.y);
    fly(ctx, 20);
    const after = distance(aa.position!.x, aa.position!.y, drone.position!.x, drone.position!.y);

    expect(after).toBeGreaterThan(before);
  });

  it('ignores an enemy that cannot shoot upward', () => {
    const { ctx, drone } = stage();
    const cannon = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: drone.position!.x - 150, y: drone.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    const front = { x: cannon.position!.x - 300, y: cannon.position!.y };
    for (let i = 0; i < 3; i++) {
      const r = spawnRobot(ctx.world, BOT, { x: front.x + i * 20, y: front.y }, ChassisType.Tracks, WeaponType.Cannon);
      r.script = makeAttackBase();
    }

    fly(ctx, 30);

    // It escorted the push straight past the cannon instead of flinching.
    expect(distance(front.x, front.y, drone.position!.x, drone.position!.y)).toBeLessThan(
      distance(front.x, front.y, cannon.position!.x, cannon.position!.y),
    );
  });

  it('pickets its own base once damaged, instead of scouting on', () => {
    const { ctx, home, drone } = stage();
    drone.hp = drone.maxHp! * (gameConfig.ai.droneCautiousHp - 0.05);
    // A push it would otherwise escort clear across the map.
    for (let i = 0; i < 3; i++) {
      const r = spawnRobot(ctx.world, BOT, { x: 200 + i * 20, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
      r.script = makeAttackBase();
    }

    let furthest = 0;
    for (let i = 0; i < 600; i++) {
      fly(ctx, 1);
      furthest = Math.max(furthest, distance(home.x, home.y, drone.position!.x, drone.position!.y));
    }

    expect(furthest).toBeLessThanOrEqual(gameConfig.ai.dronePicketRadius + 1);
  });
});

describe('pilotDrone — no drone in the air', () => {
  it('neutralises the stick and forgets the sweep while one is being rebuilt', () => {
    const { ctx } = stage();
    fly(ctx, 30);
    expect(ctx.ai[BOT]!.droneWaypoint).toBeDefined();

    for (const d of [...ctx.world.with('drone').entities]) ctx.world.remove(d);
    pilotDrone(ctx, BOT, ctx.ai[BOT]!);

    expect(ctx.droneControl[BOT].dir).toEqual({ x: 0, y: 0 });
    expect(ctx.ai[BOT]!.droneWaypoint).toBeUndefined();
  });
});

describe('pilotDrone — determinism', () => {
  it('two peers on the same seed fly the drone to the same place', () => {
    const run = (): Vec2 => {
      const { ctx, drone } = stage(7);
      fly(ctx, 300);
      return { ...drone.position! };
    };

    expect(run()).toEqual(run());
  });
});
