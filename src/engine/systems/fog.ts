import { gameConfig } from '../../config/gameConfig';
import { Owner } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';

/**
 * Player fog-of-war. Each tick, recomputes which tiles are currently within
 * sight of a living player robot, base, or the observer drone; `explored` only
 * grows (terrain is static, so remembered ground stays revealed). An enemy
 * (AI) `ew` robot jams a scout that sits inside its `jamRadius`, halving that
 * scout's effective sight for this pass (see `gameConfig.combat.jamMultiplier`).
 * Bumps `fog.version` whenever the mask changes so the renderer can skip
 * redraws. Player-only — the AI has no fog to draw.
 */
export function fogSystem(ctx: GameContext): void {
  const { width, height, tilePx } = gameConfig.grid;
  const fog = ctx.fog;

  const alive = (e: Entity): boolean => e.owner === Owner.Player && (e.hp ?? 0) > 0;
  const scouts = [
    ...ctx.world.with('robot', 'position').entities.filter(alive),
    ...ctx.world.with('base', 'position').entities.filter(alive),
    // The drone has no hp; include it on owner + sight range only.
    ...ctx.world
      .with('drone', 'position')
      .entities.filter((e) => e.owner === Owner.Player && (e.sightRange ?? 0) > 0),
  ].filter((s) => (s.sightRange ?? 0) > 0);

  const jammers = ctx.world
    .with('robot', 'position', 'weapon')
    .entities.filter((e) => e.owner === Owner.AI && (e.hp ?? 0) > 0 && e.weapon!.jamRadius > 0);

  // Jammed status only depends on the scout's own position, so resolve it once
  // per scout instead of re-checking it for every tile below.
  const effectiveRanges = scouts.map((s) => {
    const jammed = jammers.some(
      (j) => distance(j.position!.x, j.position!.y, s.position!.x, s.position!.y) <= j.weapon!.jamRadius,
    );
    return { scout: s, range: jammed ? s.sightRange! * gameConfig.combat.jamMultiplier : s.sightRange! };
  });

  let changed = false;
  for (let ty = 0; ty < height; ty++) {
    const visRow = fog.visible[ty];
    const expRow = fog.explored[ty];
    for (let tx = 0; tx < width; tx++) {
      const cx = (tx + 0.5) * tilePx;
      const cy = (ty + 0.5) * tilePx;
      const seen = effectiveRanges.some(
        ({ scout, range }) => distance(scout.position!.x, scout.position!.y, cx, cy) <= range,
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
