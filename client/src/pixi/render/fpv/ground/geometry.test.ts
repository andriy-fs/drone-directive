import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import type { TerrainGrid } from '../../../../engine/obstacles';
import { heightField, landformSegments, type Segment } from './geometry';

/**
 * The relief, on grids small enough to reason about. What is checked here is the
 * part a screenshot cannot settle: that the surface is *continuous* (a shared
 * corner has one height, so the mesh cannot tear), that a mountain goes up while a
 * crater goes down, and that a big landform out-tops a small one — which is the
 * whole reason the height is read off the distance transform rather than being a
 * constant per tile.
 *
 * `landformSegments` is checked for the property the view exists to deliver: that a
 * boundary a robot cannot cross has something *vertical* on it. A screenshot can say
 * whether that reads; only this can say whether it is there at all, and whether it
 * stands on its own ground.
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

/** Segments that go straight up or down: one map position, two heights. */
function ribs(segments: Segment[]): Segment[] {
  return segments.filter((s) => s.x0 === s.x1 && s.y0 === s.y1);
}

describe('landformSegments', () => {
  it('draws nothing on open ground', () => {
    const terrain = grid('...', '...', '...');
    expect(landformSegments(terrain, heightField(terrain))).toEqual([]);
  });

  it('stands a cliff up at a mountain, and hangs one down into a crater', () => {
    const mountain = grid('.....', '.###.', '.###.', '.....');
    const crater = grid('.....', '.ooo.', '.ooo.', '.....');
    const up = landformSegments(mountain, heightField(mountain));
    const down = landformSegments(crater, heightField(crater));

    expect(ribs(up).length).toBeGreaterThan(0);
    expect(ribs(down).length).toBeGreaterThan(0);
    // A rise never dips below the ground it stands on, and a pit never pokes above it.
    expect(Math.min(...up.map((s) => Math.min(s.h0, s.h1)))).toBeGreaterThanOrEqual(0);
    expect(Math.max(...down.map((s) => Math.max(s.h0, s.h1)))).toBeLessThanOrEqual(0);
  });

  it('tops the cliff out at the rim tile\'s own height, whatever the massif behind it', () => {
    // Every tile touching the outline is one step of depth in, so the crest is one
    // height all the way round — the summit rises behind it, not at it.
    const small = grid('...', '.#.', '...');
    const big = grid('.......', '.#####.', '.#####.', '.#####.', '.#####.', '.......');
    const crest = (t: TerrainGrid) => Math.max(...landformSegments(t, heightField(t)).map((s) => Math.max(s.h0, s.h1)));
    expect(crest(small)).toBeCloseTo(crest(big), 6);
    // And it clears the camera's own perch, which is the whole point of the change.
    expect(crest(big)).toBeGreaterThan(gameConfig.drone.fpv.height / 2);
  });

  it('stands every rib on the ground under it rather than on zero', () => {
    // The foot ramp has already lifted the surface by the time the outline reaches
    // it. A rib that started at zero would hang off the bottom of its own cliff.
    const terrain = grid('.....', '.###.', '.###.', '.###.', '.....');
    const h = heightField(terrain);
    for (const rib of ribs(landformSegments(terrain, h))) {
      expect(rib.h0).toBeCloseTo(h.at(rib.x0, rib.y0), 6);
      expect(rib.h1).not.toBeCloseTo(rib.h0, 3); // and it genuinely goes somewhere
    }
  });

  it('closes the crest into a loop', () => {
    const terrain = grid('.....', '.###.', '.###.', '.....');
    const segments = landformSegments(terrain, heightField(terrain));
    const crest = segments.filter((s) => s.h0 === s.h1 && s.h0 > 0);
    // Every crest sample is joined to the next, so the run of them ends where it began.
    const first = crest[0];
    const last = crest[crest.length - 1];
    expect(last.x1).toBeCloseTo(first.x0, 6);
    expect(last.y1).toBeCloseTo(first.y0, 6);
  });

  it('still cliffs a landform pressed against the edge of the map', () => {
    // The depth transform reads off-map as open, so a cluster on the edge is the
    // shallowest one there is — and the case most likely to come out empty.
    const terrain = grid('##..', '##..', '....');
    expect(ribs(landformSegments(terrain, heightField(terrain))).length).toBeGreaterThan(0);
  });
});
