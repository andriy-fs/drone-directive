import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../config/gameConfig';
import type { TerrainGrid } from '../../../engine/obstacles';
import { heightField } from './terrain';

/**
 * The relief, on grids small enough to reason about. What is checked here is the
 * part a screenshot cannot settle: that the surface is *continuous* (a shared
 * corner has one height, so the mesh cannot tear), that a mountain goes up while a
 * crater goes down, and that a big landform out-tops a small one — which is the
 * whole reason the height is read off the distance transform rather than being a
 * constant per tile.
 */

const O = TerrainKind.Open;
const M = TerrainKind.Mountain;
const C = TerrainKind.Crater;

/** `.` open, `#` mountain, `o` crater — one character per tile. */
function grid(...rows: string[]): TerrainGrid {
  return rows.map((row) => [...row].map((c) => (c === '#' ? M : c === 'o' ? C : O)));
}

const { tilePx } = gameConfig.grid;

describe('heightField', () => {
  it('leaves open ground flat', () => {
    const h = heightField(grid('...', '...', '...'));
    expect(h.tilesX).toBe(3);
    expect(h.tilesY).toBe(3);
    for (let cy = 0; cy <= 3; cy++) {
      for (let cx = 0; cx <= 3; cx++) expect(h.corner(cx, cy)).toBe(0);
    }
  });

  it('raises a mountain and sinks a crater', () => {
    const h = heightField(grid('.....', '.#.o.', '.....'));
    // Sampled at the tile's centre, where the four corners it shares are all its own.
    expect(h.at(1.5 * tilePx, 1.5 * tilePx)).toBeGreaterThan(0);
    expect(h.at(3.5 * tilePx, 1.5 * tilePx)).toBeLessThan(0);
  });

  it('makes a large massif taller than a lone bump', () => {
    const lone = heightField(grid('.....', '..#..', '.....'));
    const massif = heightField(
      grid('.......', '.#####.', '.#####.', '.#####.', '.#####.', '.#####.', '.......'),
    );
    const peak = massif.at(3.5 * tilePx, 3.5 * tilePx);
    expect(peak).toBeGreaterThan(lone.at(2.5 * tilePx, 1.5 * tilePx) * 2);
  });

  it('shares one height at a corner between neighbouring tiles', () => {
    const h = heightField(grid('....', '.##.', '.##.', '....'));
    // Sampling the same grid corner from inside each of the four tiles that meet
    // there has to land on one number, or the wireframe tears along tile edges.
    const eps = 0.001;
    const at = (dx: number, dy: number) => h.at(2 * tilePx + dx, 2 * tilePx + dy);
    expect(at(-eps, -eps)).toBeCloseTo(at(eps, eps), 3);
    expect(at(eps, -eps)).toBeCloseTo(at(-eps, eps), 3);
  });

  it('ramps down to ground level over the one tile outside a landform', () => {
    const h = heightField(grid('.....', '.###.', '.###.', '.###.', '.....'));
    const inside = h.at(2.5 * tilePx, 2.5 * tilePx);
    const rim = h.at(1 * tilePx, 2.5 * tilePx);
    // Averaging corners spills the foot of the mass one tile onto the open ground
    // beside it — the documented price of a surface that cannot tear. It is a ramp,
    // not a step, and it is *done* by the far side of that tile.
    const foot = h.at(0.5 * tilePx, 2.5 * tilePx);
    expect(inside).toBeGreaterThan(rim);
    expect(rim).toBeGreaterThan(foot);
    expect(foot).toBeGreaterThan(0);
    expect(h.at(0, 2.5 * tilePx)).toBeCloseTo(0, 5);
  });

  it('reads ground level off the map rather than throwing', () => {
    const h = heightField(grid('..', '..'));
    expect(h.corner(-1, 0)).toBe(0);
    expect(h.corner(0, 99)).toBe(0);
    expect(h.at(-500, -500)).toBe(0);
    expect(h.at(99999, 99999)).toBe(0);
  });
});
