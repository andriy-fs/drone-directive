import { hashRange } from './hash';

/**
 * Where a grid corner is actually drawn — the cure for the tetris effect.
 *
 * Terrain is generated on a 32 px grid, so every silhouette it produces is made of
 * axis-aligned segments meeting at exact right angles. No amount of texture fixes
 * that: the eye reads the *outline*, and a perfect staircase reads as a tile map
 * however good the rock on it is.
 *
 * **The fix is not transition tiles.** A tileset of bevelled corners would put the
 * grid back with extra steps — 32 px of period, a finite set of corner shapes, and a
 * new asset for every case. Instead the grid's own **corners are displaced**: every
 * node moves by a few pixels in a direction that is a pure function of its
 * coordinates, so the outline stops being straight while the tiles still meet
 * exactly.
 *
 * Three properties make this work, and all three come from the displacement being a
 * function of the corner alone:
 *
 * 1. **No gaps.** Two tiles sharing a corner get the same displacement for it, so
 *    quads that met before still meet.
 * 2. **Kind-independent.** A mountain and a crater sharing a corner move it the same
 *    way, so their fills stay flush instead of tearing apart along the seam.
 * 3. **Pass-independent.** Fill, rim, cast shadow and the cliff's base all ask this
 *    module where a corner is, so the whole landform deforms together rather than the
 *    silhouette drifting out from under its own shading.
 *
 * The texture does not smear: the fills are sampled in **world space**, so a vertex
 * that moves takes its texture coordinate with it.
 *
 * **Magnitude is capped well under a robot's radius** (11 px). Collision, pathing and
 * fog stay exactly on the grid — this is a lie told by the renderer, and it has to
 * stay small enough that no player ever catches it saying a tile is passable when it
 * is not.
 */

/** How far a corner may move from its grid position, in px, on each axis. */
const WARP_PX = 6;

/** Salt pair — the two axes must not share one, or every corner would move diagonally. */
const SALT_X = 0x3f1;
const SALT_Y = 0x7c5;

/** Displacement of one grid corner, in px. Pure function of the corner's coordinates. */
export function cornerWarp(cx: number, cy: number): { dx: number; dy: number } {
  return {
    dx: hashRange(cx, cy, SALT_X, -WARP_PX, WARP_PX),
    dy: hashRange(cx, cy, SALT_Y, -WARP_PX, WARP_PX),
  };
}

/** World position of a grid corner, displacement included. */
export function warpedCorner(cx: number, cy: number, tilePx: number): { x: number; y: number } {
  const { dx, dy } = cornerWarp(cx, cy);
  return { x: cx * tilePx + dx, y: cy * tilePx + dy };
}
