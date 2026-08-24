import { describe, expect, it } from 'vitest';
import { Owner } from '@drone-directive/types/enums';
import { baseGaitSprites } from '../../config/sprites';
import { cellAt } from './cycle';

const PERIOD = 1200;
const CELLS = 4;
/** The square `scripts/encode-sprites.mjs` ships a base idle sheet at. */
const SHEET_PX = 512;

describe('cellAt', () => {
  it('starts on the rest pose', () => {
    // Cell 0 is the pose every timed sheet is drawn around, so a view built on
    // the first frame of a match must not open mid-cycle.
    expect(cellAt(0, PERIOD, 0, CELLS)).toBe(0);
  });

  it('steps through every cell exactly once per period', () => {
    const seen = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cellAt((i * PERIOD) / 8, PERIOD, 0, CELLS));
    expect(seen).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('loops rather than running off the end of the sheet', () => {
    // `now` is wall-clock time and is never reset, so by mid-match it is enormous
    // next to the period.
    expect(cellAt(PERIOD * 1000, PERIOD, 0, CELLS)).toBe(0);
    expect(cellAt(PERIOD * 1000.3, PERIOD, 0, CELLS)).toBe(1);
  });

  it('offsets by whole turns without changing the cell', () => {
    // The phase is what keeps two bases from pulsing together; a whole turn of it
    // is a no-op, which is what makes it safe to hand any hash value.
    expect(cellAt(PERIOD * 0.3, PERIOD, 1, CELLS)).toBe(cellAt(PERIOD * 0.3, PERIOD, 0, CELLS));
    expect(cellAt(PERIOD * 0.3, PERIOD, 0.25, CELLS)).toBe(2);
  });

  it('never returns an index outside the sheet, even at a negative phase', () => {
    // A negative index would run past the array and hand the view `undefined`
    // where it expects a texture.
    for (const phase of [-0.1, -0.25, -1, -3.7]) {
      const cell = cellAt(PERIOD * 0.1, PERIOD, phase, CELLS);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(CELLS);
    }
  });
});

describe('baseGaitSprites', () => {
  // Same coupling `gait.test.ts` guards for the robots: `frame` is in the shipped
  // texture's pixel space, so a quadrant here is half of a `size` over in
  // scripts/encode-sprites.mjs. A wrong quadrant still resolves — it just crops the
  // wrong part of the sheet — so nothing else would catch the two drifting apart.
  it.each([Owner.Player, Owner.AI])('slices %s into four quadrants of the shipped sheet', (owner) => {
    const frames = baseGaitSprites[owner];
    expect(frames).toHaveLength(CELLS);
    const q = SHEET_PX / 2;
    // Reading order — the idle cycle depends on it, unlike the decal sheets.
    expect(frames?.map((f) => f.frame)).toEqual([
      { x: 0, y: 0, w: q, h: q },
      { x: q, y: 0, w: q, h: q },
      { x: 0, y: q, w: q, h: q },
      { x: q, y: q, w: q, h: q },
    ]);
    // A base does not rotate, so its cells carry no facing correction.
    expect(frames?.every((f) => f.rotationOffset === undefined)).toBe(true);
  });
});
