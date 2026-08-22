import { isAlive } from './ecs/guards';
import { bases } from './ecs/queries';
import type { GameContext } from './game/context';
import { withBaseFootprints } from './obstacles';

/**
 * Recomputes `ctx.navObstacles` = terrain + the footprints of every *living*
 * base, so robots pathfind around bases (a base is impassable until destroyed).
 * Call after bases spawn (match start) and whenever a base dies (`reap`).
 */
export function refreshNavObstacles(ctx: GameContext): void {
  const living = bases(ctx.world)
    .entities.filter(isAlive)
    .map((b) => ({ position: b.position, footprint: b.footprint }));
  ctx.navObstacles = withBaseFootprints(ctx.obstacles, living);
  ctx.navVersion++;
}
