import { gameConfig } from '../../config/gameConfig';
import { Controller, type Owner } from '../../types/enums';
import { spawnDrone } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { ownBase } from './targeting';

/**
 * Replaces a shot-down observer drone after `gameConfig.drone.respawnTime`.
 *
 * A side without its eye keeps only the sight its ground units and base provide
 * — that stretch of blindness is the price of flying the drone carelessly, and
 * it is what stops the drone from being a free, permanent advantage.
 *
 * The countdown is derived from the world (no drone + a base to build one =
 * rebuild in progress) rather than hooked onto the death event, so `reapSystem`
 * stays generic and a mid-match reload of state can't leave a stale timer.
 * Runs right after `reapSystem` so the drone destroyed this tick is already gone.
 *
 * Only human sides fly one (bots never had a drone), and a side whose base has
 * fallen builds nothing — it is out of the match anyway.
 */
export function droneRespawnSystem(ctx: GameContext, dt: number): void {
  for (const side of ctx.roster) {
    if (side.controller !== Controller.Human) continue;
    step(ctx, side.owner, dt);
  }
}

function step(ctx: GameContext, owner: Owner, dt: number): void {
  if (hasDrone(ctx, owner)) {
    ctx.droneRespawn[owner] = 0;
    return;
  }

  const base = ownBase(ctx, owner);
  if (!base?.position) {
    ctx.droneRespawn[owner] = 0; // nothing left to build it from
    return;
  }

  // First tick without a drone: start the clock. Otherwise run it down, and
  // roll the replacement out over the base once it reaches zero.
  if (ctx.droneRespawn[owner] <= 0) {
    ctx.droneRespawn[owner] = gameConfig.drone.respawnTime;
    return;
  }

  ctx.droneRespawn[owner] -= dt;
  if (ctx.droneRespawn[owner] > 0) return;

  ctx.droneRespawn[owner] = 0;
  const drone = spawnDrone(ctx.world, owner, base.position);
  ctx.bus.emit('entitySpawned', { id: drone.id, kind: 'drone', owner });
}

function hasDrone(ctx: GameContext, owner: Owner): boolean {
  return ctx.world.with('drone').entities.some((e) => e.owner === owner && (e.hp ?? 0) > 0);
}
