import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { Controller, Owner } from '../../types/enums';
import { spawnBase, spawnDrone } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { droneRespawnSystem } from './droneRespawn';
import { makeCtx } from './testkit';

const DT = gameConfig.fixedDt;

function droneOf(ctx: GameContext, owner: Owner) {
  return ctx.world.with('drone').entities.find((d) => d.owner === owner);
}

/** Run the system for `seconds` of simulated time, one fixed step at a time. */
function advance(ctx: GameContext, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) droneRespawnSystem(ctx, DT);
}

describe('droneRespawnSystem', () => {
  it('leaves a living drone alone and keeps the clock at zero', () => {
    const ctx = makeCtx(1);
    spawnBase(ctx.world, Owner.Player, 4, 33);
    spawnDrone(ctx.world, Owner.Player, { x: 200, y: 200 });

    advance(ctx, 2);

    expect(ctx.droneRespawn[Owner.Player]).toBe(0);
    expect(ctx.world.with('drone').entities).toHaveLength(1);
  });

  it('starts the clock the moment the side is left without an eye', () => {
    const ctx = makeCtx(1);
    spawnBase(ctx.world, Owner.Player, 4, 33);

    droneRespawnSystem(ctx, DT);

    expect(ctx.droneRespawn[Owner.Player]).toBe(gameConfig.drone.respawnTime);
    expect(droneOf(ctx, Owner.Player)).toBeUndefined();
  });

  it('rebuilds the drone over the base once the clock runs out', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);

    // A full respawnTime of ticks still falls short — the first tick only starts
    // the clock, it doesn't count against it.
    advance(ctx, gameConfig.drone.respawnTime);
    expect(droneOf(ctx, Owner.Player)).toBeUndefined();

    advance(ctx, DT * 2);

    const drone = droneOf(ctx, Owner.Player);
    expect(drone).toBeDefined();
    expect(drone!.position).toEqual(base.position);
    expect(drone!.hp).toBe(gameConfig.drone.maxHp);
    expect(ctx.droneRespawn[Owner.Player]).toBe(0);
  });

  it('builds nothing for a side whose base has fallen', () => {
    const ctx = makeCtx(1);

    advance(ctx, gameConfig.drone.respawnTime * 2);

    expect(droneOf(ctx, Owner.Player)).toBeUndefined();
    expect(ctx.droneRespawn[Owner.Player]).toBe(0);
  });

  it('never gives a bot side a drone', () => {
    const ctx = makeCtx(1);
    ctx.roster = [{ owner: Owner.AI, controller: Controller.Bot }];
    spawnBase(ctx.world, Owner.AI, 33, 4);

    advance(ctx, gameConfig.drone.respawnTime * 2);

    expect(ctx.world.with('drone').entities).toHaveLength(0);
    expect(ctx.droneRespawn[Owner.AI]).toBe(0);
  });
});
