import { gameConfig } from '../config/gameConfig';
import type { GameContext } from './game/context';
import { withBaseFootprints } from './obstacles';

/**
 * Recomputes `ctx.navObstacles` = terrain + the footprints of every *living*
 * base, so robots pathfind around bases (a base is impassable until destroyed).
 * Call after bases spawn (match start) and whenever a base dies (`reap`).
 */
export function refreshNavObstacles(ctx: GameContext): void {
  const bases = ctx.world
    .with('base', 'position')
    .entities.filter((b) => (b.hp ?? 0) > 0)
    .map((b) => ({
      position: b.position!,
      footprint: b.footprint ?? gameConfig.bases.footprintTiles,
    }));
  ctx.navObstacles = withBaseFootprints(ctx.obstacles, bases);
}
