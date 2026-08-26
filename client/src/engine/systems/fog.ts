import { gameConfig } from '../../config/gameConfig';
import type { With } from 'miniplex';
import type { Entity } from '../ecs/entity';
import { bases, drones, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { sightlinesFor, withinSight } from './vision';

/** A robot, base or drone seen only as "something with eyes" — see `vision.ts`. */
type Scout = With<Entity, 'position' | 'owner' | 'hp' | 'sightRange'>;

/**
 * Player fog-of-war. Each tick, recomputes which tiles are currently within
 * sight of a living player robot, base, or the observer drone; `explored` only
 * grows (terrain is static, so remembered ground stays revealed). An enemy
 * (AI) `ew` robot jams a scout that sits inside its `jamRadius`, halving that
 * scout's effective sight for this pass (see `gameConfig.combat.jamMultiplier`).
 * Bumps `fog.version` whenever the mask changes so the renderer can skip
 * redraws. Computed for `ctx.localSide` — the side this client is playing (Player
 * offline and for the host; AI for the online guest).
 */
export function fogSystem(ctx: GameContext): void {
  const { width, height, tilePx } = gameConfig.grid;
  const fog = ctx.fog;
  const side = ctx.localSide;

  const alive = (e: Scout): boolean => e.owner === side && e.hp > 0;
  const scouts: Scout[] = [
    ...robots(ctx.world).entities.filter(alive),
    ...bases(ctx.world).entities.filter(alive),
    // The drone isn't a robot, so it needs its own pass; a shot-down one reveals
    // nothing (it's reaped the same tick, but `alive` keeps that explicit), and one
    // riding a hull reveals nothing either — it has stopped being an eye.
    ...drones(ctx.world).entities.filter((d) => alive(d) && !d.drone.possessedId),
  ].filter((s) => s.sightRange > 0);

  // Ranges and sectors both come from `vision.ts`. This file used to work out
  // jamming for itself and had already drifted from detection over whether a
  // knocked-out jammer still jams; a sight cone applied by only one of the two
  // would be a worse version of the same mistake, because the mask and the
  // detection set would then be answering different questions about the same eye.
  // Resolved once per scout — the loop below asks about it for every tile.
  const lines = sightlinesFor(ctx, side, scouts);

  let changed = false;
  for (let ty = 0; ty < height; ty++) {
    const visRow = fog.visible[ty];
    const expRow = fog.explored[ty];
    for (let tx = 0; tx < width; tx++) {
      const cx = (tx + 0.5) * tilePx;
      const cy = (ty + 0.5) * tilePx;
      const seen = lines.some(({ scout, range, cone }) => withinSight(scout, cx, cy, range, cone));
      if (visRow[tx] !== seen) {
        visRow[tx] = seen;
        changed = true;
      }
      if (seen && !expRow[tx]) {
        expRow[tx] = true;
        changed = true;
      }
    }
  }

  if (changed) fog.version++;
}
