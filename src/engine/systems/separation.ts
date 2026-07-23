import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { clamp } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';

/**
 * Resolves robot-robot overlap: any two living robots closer than their
 * combined collision radius get pushed apart along the line between them,
 * split evenly. Corrective (runs after movement), not preventive — cheap
 * O(n^2) over the small robot counts this game supports, and self-stabilizes
 * every tick, so robots never settle stacked on the same coordinates.
 */
export function separationSystem(ctx: GameContext): void {
  const minDist = gameConfig.robots.radius * 2;
  const robots = ctx.world.with('robot', 'position').entities;

  for (let i = 0; i < robots.length; i++) {
    const a = robots[i];
    if ((a.hp ?? 0) <= 0) continue;
    for (let j = i + 1; j < robots.length; j++) {
      const b = robots[j];
      if ((b.hp ?? 0) <= 0) continue;
      separate(a, b, minDist);
    }
  }
}

function separate(a: Entity, b: Entity, minDist: number): void {
  const ap = a.position!;
  const bp = b.position!;
  let dx = bp.x - ap.x;
  let dy = bp.y - ap.y;
  const trueDist = Math.hypot(dx, dy);
  if (trueDist >= minDist) return;

  // `dist` only normalizes the push direction; the push *magnitude* below always
  // uses `trueDist` so a coincident pair (trueDist 0) still ends up exactly
  // `minDist` apart, not `minDist - 1`.
  let dist = trueDist;
  if (dist < 1e-6) {
    // Exactly coincident (e.g. spawned on the same tile): nudge apart along a
    // stable per-pair direction — no Math.random, keeps the sim deterministic.
    const angle = coincidentAngle(a.id, b.id);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    dist = 1;
  }

  const push = (minDist - trueDist) / 2;
  const nx = (dx / dist) * push;
  const ny = (dy / dist) * push;
  ap.x = clamp(ap.x - nx, 0, worldPixelSize.width);
  ap.y = clamp(ap.y - ny, 0, worldPixelSize.height);
  bp.x = clamp(bp.x + nx, 0, worldPixelSize.width);
  bp.y = clamp(bp.y + ny, 0, worldPixelSize.height);
}

/** Stable pseudo-random direction for a pair of ids (order-independent). */
function coincidentAngle(idA: string, idB: string): number {
  const key = idA < idB ? idA + idB : idB + idA;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 360) * Math.PI) / 180;
}
