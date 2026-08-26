import { gameConfig } from '../../config/gameConfig';
import { distance } from '../../utils/math';
import type { With } from 'miniplex';
import type { Entity } from '../ecs/entity';
import { bases, drones, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { jamPressureFrom, jammersAgainst } from './vision';

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
    // nothing (it's reaped the same tick, but `alive` keeps that explicit).
    ...drones(ctx.world).entities.filter(alive),
  ].filter((s) => s.sightRange > 0);

  // The jamming rule itself lives in `vision.ts` — this used to be a second copy
  // of it, and the two had already drifted apart over whether a *disabled* jammer
  // still jams. Detection said no; this said yes. They agree now, on detection's
  // answer: a knocked-out jammer emits nothing.
  const jammers = jammersAgainst(ctx, side);

  // Jammed status only depends on the scout's own position, so resolve it once
  // per scout instead of re-checking it for every tile below.
  const effectiveRanges = scouts.map((s) => {
    const jammed = jamPressureFrom(jammers, s.position.x, s.position.y) > 0;
    return { scout: s, range: jammed ? s.sightRange * gameConfig.combat.jamMultiplier : s.sightRange };
  });

  let changed = false;
  for (let ty = 0; ty < height; ty++) {
    const visRow = fog.visible[ty];
    const expRow = fog.explored[ty];
    for (let tx = 0; tx < width; tx++) {
      const cx = (tx + 0.5) * tilePx;
      const cy = (ty + 0.5) * tilePx;
      const seen = effectiveRanges.some(
        ({ scout, range }) => distance(scout.position.x, scout.position.y, cx, cy) <= range,
      );
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
