import { gameConfig } from '../../../config/gameConfig';
import { inBounds, isBlockedGrid, type ObstacleGrid } from '../../obstacles';
import type { OrcaSolver } from './solver';

/**
 * Static geometry as ORCA half-planes, straight off the tile grid.
 *
 * **Why not real RVO2 obstacle lines.** The reference implementation takes a
 * polygon soup with ordered vertices, prev/next links and per-vertex convexity
 * flags, and spends ~150 lines on left-leg/right-leg/oblique-view cases. Building
 * that from a tile grid needs contour tracing with a deterministic winding rule
 * and a rebuild every time `refreshNavObstacles` runs. All of that to describe
 * geometry which is *entirely axis-aligned boxes* — for which the constraint
 * "do not penetrate this box within tau" has an exact closed form:
 *
 *   q = the nearest point on the tile's box to the agent
 *   d = |pos - q|,  n = (pos - q) / d
 *   v·n >= -(d - radius) * invTauObst
 *
 * Exact on a face, conservative at a corner (it treats the corner as a disc),
 * allocation-free, and no rebuild hook.
 *
 * **Why walls are not optional.** The layer this replaces (`steerAround`) only
 * ever deflected along the direction of travel and gave up when nothing cleared,
 * so it never produced sustained sideways force. ORCA does: two counter-flowing
 * groups in a 96 px corridor push each other outward every tick. Meanwhile
 * `smoothPath` cuts corners to exactly hull width, so a smoothed leg is only valid
 * from where it was computed. Without wall constraints ORCA presses hulls into the
 * rock those two facts leave no room for.
 *
 * Out-of-bounds counts as blocked in `isBlockedGrid`, so the map edge is handled
 * by the same code with no special case.
 */

/** Scanned window, in tiles either side of the agent's own tile. */
const SCAN = 2;

export function collectWalls(
  grid: ObstacleGrid,
  px: number,
  py: number,
  radius: number,
  maxSpeed: number,
  invTauObst: number,
  solver: OrcaSolver,
  agent: number,
): void {
  const { tilePx } = gameConfig.grid;
  const atx = Math.floor(px / tilePx);
  const aty = Math.floor(py / tilePx);
  // Nothing further than one horizon of travel can constrain this tick.
  const reach = radius + maxSpeed / invTauObst;

  // Fixed scan order — ty then tx, ascending. The solver treats constraint order
  // as part of the answer, so this loop may never be reordered or parallelised.
  for (let ty = aty - SCAN; ty <= aty + SCAN; ty++) {
    for (let tx = atx - SCAN; tx <= atx + SCAN; tx++) {
      if (!isBlockedGrid(grid, tx, ty)) continue;

      const minX = tx * tilePx;
      const minY = ty * tilePx;
      const maxX = minX + tilePx;
      const maxY = minY + tilePx;

      const inside = px >= minX && px <= maxX && py >= minY && py <= maxY;
      let nx: number;
      let ny: number;
      let d: number;

      if (inside) {
        // The hull's centre is in the rock — shoved there by separation, or left
        // there when a base spawned on top of it. There is no "nearest point"
        // to push away from, so leave through the nearest face. Ordered
        // left/right/up/down with `<` so ties resolve the same way every time.
        const toMinX = px - minX;
        const toMaxX = maxX - px;
        const toMinY = py - minY;
        const toMaxY = maxY - py;
        let best = toMinX;
        nx = -1;
        ny = 0;
        if (toMaxX < best) {
          best = toMaxX;
          nx = 1;
          ny = 0;
        }
        if (toMinY < best) {
          best = toMinY;
          nx = 0;
          ny = -1;
        }
        if (toMaxY < best) {
          nx = 0;
          ny = 1;
        }
        d = 0;
      } else {
        const qx = px < minX ? minX : px > maxX ? maxX : px;
        const qy = py < minY ? minY : py > maxY ? maxY : py;
        const dx = px - qx;
        const dy = py - qy;
        const distSq = dx * dx + dy * dy;
        d = Math.sqrt(distSq);
        if (d > reach) continue;
        nx = dx / d;
        ny = dy / d;
      }

      // An interior face is redundant: if the tile **between this one and the
      // agent** is also rock, the agent is already constrained by that nearer
      // face and this one is buried behind it.
      //
      // The direction matters and is easy to get backwards. `n` points from the
      // rock toward the agent, so the tile toward the agent is `+ round(n)`, not
      // `- round(n)`. Getting this wrong culls exactly the faces that do the work
      // and keeps the ones behind them, which still produce a plausible-looking
      // push — the corridor harness caught it as hulls driving into walls while
      // every unit test stayed green.
      if (!inside) {
        const throughX = tx + Math.round(nx);
        const throughY = ty + Math.round(ny);
        if (
          (throughX !== tx || throughY !== ty) &&
          inBounds(throughX, throughY) &&
          isBlockedGrid(grid, throughX, throughY)
        ) {
          continue;
        }
      }

      // `v·n >= limit`. Outside the rock the hull may still close the gap, but no
      // faster than clears it within the horizon. Inside it, the sign flips and the
      // constraint *demands* outward motion — without that a hull in rock reads a
      // constraint it already violates and is told to stay.
      const limit = inside ? radius * invTauObst : -(d - radius) * invTauObst;
      solver.addWall(agent, nx, ny, limit);
    }
  }
}
