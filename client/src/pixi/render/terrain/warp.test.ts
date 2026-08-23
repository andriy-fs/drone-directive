import { describe, expect, it } from 'vitest';
import { cornerWarp, warpedCorner } from './warp';

const TILE = 32;
/** `WARP_PX` in `warp.ts`. Duplicated on purpose: a test that imports the number it checks checks nothing. */
const MAX = 6;

describe('cornerWarp', () => {
  it('gives one corner the same displacement every time it is asked', () => {
    // Every pass that touches the silhouette calls this independently — the fill, the
    // rim, the cast shadow, the cliff base. They agree only because it is a function.
    expect(cornerWarp(4, 7)).toEqual(cornerWarp(4, 7));
  });

  it('moves neighbouring corners differently', () => {
    // A displacement that varied slowly would slide the whole silhouette instead of
    // bending it, and the grid would survive.
    expect(cornerWarp(4, 7)).not.toEqual(cornerWarp(5, 7));
    expect(cornerWarp(4, 7)).not.toEqual(cornerWarp(4, 8));
  });

  it('stays well inside a robot radius', () => {
    // The collision grid is not warped, so this is the renderer lying about where the
    // rock is. At 11 px (the robot radius) the lie would be catchable.
    for (let cx = 0; cx < 40; cx++) {
      for (let cy = 0; cy < 40; cy++) {
        const { dx, dy } = cornerWarp(cx, cy);
        expect(Math.abs(dx)).toBeLessThanOrEqual(MAX);
        expect(Math.abs(dy)).toBeLessThanOrEqual(MAX);
      }
    }
  });

  it('does not leave a corner exactly on the grid across a whole map', () => {
    let onGrid = 0;
    for (let cx = 0; cx < 40; cx++) {
      for (let cy = 0; cy < 40; cy++) {
        const { dx, dy } = cornerWarp(cx, cy);
        if (dx === 0 && dy === 0) onGrid++;
      }
    }
    expect(onGrid).toBe(0);
  });
});

describe('warpedCorner', () => {
  it('places a corner within one warp of its grid position', () => {
    // The whole contract in one line: the outline bends, but never far enough for a
    // player to catch the renderer saying a tile is passable when it is not.
    for (const [cx, cy] of [
      [0, 0],
      [3, 11],
      [39, 39],
    ]) {
      const { x, y } = warpedCorner(cx, cy, TILE);
      expect(Math.abs(x - cx * TILE)).toBeLessThanOrEqual(MAX);
      expect(Math.abs(y - cy * TILE)).toBeLessThanOrEqual(MAX);
    }
  });
});
