import { describe, expect, it } from 'vitest';
import { TerrainKind } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import type { TerrainGrid } from '../../../../engine/obstacles';
import {
  fallLineSegments,
  heightField,
  landformSegments,
  MICRO_PX,
  slopeOf,
  SLOPE_MAX,
  type Segment,
} from './geometry';

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
  it('leaves open ground level, to within the micro-relief', () => {
    const h = heightField(grid('...', '...', '...'));
    expect(h.tilesX).toBe(3);
    expect(h.tilesY).toBe(3);
    for (let cy = 0; cy <= 3; cy++) {
      for (let cx = 0; cx <= 3; cx++) {
        // The landform under it is nothing at all...
        expect(h.baseCorner(cx, cy)).toBe(0);
        // ...and what is drawn wanders by a few px, but only inside the map. The
        // boundary stays exactly level: it is the edge of the world, not terrain.
        const edge = cx === 0 || cy === 0 || cx === 3 || cy === 3;
        if (edge) expect(h.corner(cx, cy)).toBe(0);
        else expect(Math.abs(h.corner(cx, cy))).toBeLessThanOrEqual(MICRO_PX);
      }
    }
  });

  it('gives the plain a relief at all', () => {
    // The point of the whole thing: a large open field is not one flat plane, or the
    // grid over it slides instead of receding as the hull drives.
    const h = heightField(grid(...Array.from({ length: 9 }, () => '.........')));
    let moved = 0;
    for (let cy = 1; cy < 9; cy++) {
      for (let cx = 1; cx < 9; cx++) if (h.corner(cx, cy) !== 0) moved++;
    }
    expect(moved).toBeGreaterThan(50);
  });

  it('keeps the micro-relief off every corner a landform touches', () => {
    // This is what lets the cliff pass stand on exact numbers — see MICRO_PX.
    const terrain = grid('.....', '.###.', '.###.', '.###.', '.....');
    const h = heightField(terrain);
    const blocked = (tx: number, ty: number) =>
      tx >= 0 && ty >= 0 && tx < 5 && ty < 5 && terrain[ty][tx] !== O;
    for (let cy = 0; cy <= 5; cy++) {
      for (let cx = 0; cx <= 5; cx++) {
        const touches =
          blocked(cx - 1, cy - 1) || blocked(cx, cy - 1) || blocked(cx - 1, cy) || blocked(cx, cy);
        if (touches) expect(h.corner(cx, cy)).toBe(h.baseCorner(cx, cy));
      }
    }
  });

  it('places the micro-relief by hash rather than by chance', () => {
    // Two builds of the same map have to agree, or a rebuild would shift the ground
    // under a parked hull — and two players on one seed would see different fields.
    const a = heightField(grid('....', '....', '....', '....'));
    const b = heightField(grid('....', '....', '....', '....'));
    for (let cy = 0; cy <= 4; cy++) {
      for (let cx = 0; cx <= 4; cx++) expect(a.corner(cx, cy)).toBe(b.corner(cx, cy));
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

describe('slopeOf', () => {
  it('reports a level line as flat', () => {
    expect(slopeOf(0, 0, 12, 32, 0, 12)).toBe(0);
  });

  it('reports rise over run', () => {
    expect(slopeOf(0, 0, 0, 32, 0, 16)).toBeCloseTo(0.5, 6);
    // Sign is not part of it: a line is as steep going down as going up.
    expect(slopeOf(0, 0, 16, 32, 0, 0)).toBeCloseTo(0.5, 6);
  });

  it('gives a cliff rib the ceiling instead of a division by zero', () => {
    // The one vertical in the buffer, and the segment that most has to be bright.
    expect(slopeOf(64, 64, 0, 64, 64, 46)).toBe(SLOPE_MAX);
    expect(Number.isFinite(slopeOf(64, 64, 0, 64, 64, 46))).toBe(true);
  });

  it('caps a very steep line rather than running away', () => {
    expect(slopeOf(0, 0, 0, 1, 0, 1000)).toBe(SLOPE_MAX);
  });
});

describe('fallLineSegments', () => {
  const massif = grid('.......', '.#####.', '.#####.', '.#####.', '.#####.', '.......');

  it('draws nothing on open ground', () => {
    const terrain = grid('....', '....', '....', '....');
    expect(fallLineSegments(terrain, heightField(terrain))).toEqual([]);
  });

  it('hatches the flank of a massif', () => {
    expect(fallLineSegments(massif, heightField(massif)).length).toBeGreaterThan(0);
  });

  it('always points downhill', () => {
    // The whole content of the pass: a lattice cannot say which way is down, so if a
    // hair ever ran uphill it would be saying the opposite of the thing it is for.
    const crater = grid('.......', '.ooooo.', '.ooooo.', '.ooooo.', '.ooooo.', '.......');
    for (const terrain of [massif, crater]) {
      const h = heightField(terrain);
      const lines = fallLineSegments(terrain, h);
      expect(lines.length).toBeGreaterThan(0);
      // A pit falls away from its rim exactly as a mountain falls away from its
      // summit — descent is descent, whichever side of level the ground is on.
      for (const line of lines) expect(line.h1).toBeLessThan(line.h0);
    }
  });

  it('leaves a lone bump alone', () => {
    // Corner averaging makes a single tile a dome with no flank: its four corners are
    // one height, so there is no steepest descent to draw and nothing to say with it.
    const terrain = grid('.....', '..#..', '.....');
    expect(fallLineSegments(terrain, heightField(terrain))).toEqual([]);
  });

  it('stands each hair on the surface under it', () => {
    const h = heightField(massif);
    for (const line of fallLineSegments(massif, h)) {
      expect(line.h0).toBeCloseTo(h.at(line.x0, line.y0), 6);
      expect(line.h1).toBeCloseTo(h.at(line.x1, line.y1), 6);
    }
  });
});

describe('baseAt', () => {
  it('samples the landform without the micro-relief on it', () => {
    // What the camera rides. Open ground is level to it however much the drawn mesh
    // wanders, or the horizon would swing every time the hull crossed a corner.
    const h = heightField(grid('.....', '.....', '.....', '.....', '.....'));
    for (let i = 0; i < 5; i++) expect(h.baseAt((i + 0.5) * tilePx, 2.5 * tilePx)).toBe(0);
  });

  it('still follows a landform exactly', () => {
    // Only open interior corners are jittered, so over a massif the two agree.
    const terrain = grid('.....', '.###.', '.###.', '.###.', '.....');
    const h = heightField(terrain);
    expect(h.baseAt(2.5 * tilePx, 2.5 * tilePx)).toBeCloseTo(h.at(2.5 * tilePx, 2.5 * tilePx), 6);
    expect(h.baseAt(2.5 * tilePx, 2.5 * tilePx)).toBeGreaterThan(0);
  });
});
