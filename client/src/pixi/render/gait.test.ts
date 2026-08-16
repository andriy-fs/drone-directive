import { describe, expect, it } from 'vitest';
import { Owner } from '@drone-directive/types/enums';
import { robotGaitSprites } from '../../config/sprites';
import { gaitPhase } from './gait';

const STRIDE = 24;
const FRAMES = 4;
/** The square `scripts/encode-sprites.mjs` ships a gait sheet at. */
const SHEET_PX = 256;

describe('gaitPhase', () => {
  it('starts on the neutral stance with no sway', () => {
    // Cell 0 is the pose a stopped walker rests in, so a fresh view must not
    // begin mid-step or already tilted.
    const { frame, sway } = gaitPhase(0, STRIDE, FRAMES);
    expect(frame).toBe(0);
    expect(sway).toBe(0);
  });

  it('walks through every cell exactly once per stride', () => {
    const seen = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => gaitPhase((i * STRIDE) / 8, STRIDE, FRAMES).frame);
    expect(seen).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });

  it('loops rather than running off the end of the sheet', () => {
    // The accumulator is never reset while a unit is marching, so after a long
    // crossing it is far larger than the stride.
    expect(gaitPhase(STRIDE * 100, STRIDE, FRAMES).frame).toBe(0);
    expect(gaitPhase(STRIDE * 100.3, STRIDE, FRAMES).frame).toBe(1);
  });

  it('never returns an index outside the sheet, even walking backwards', () => {
    // A negative index would index past the array and hand the view `undefined`
    // where it expects a texture.
    for (const travelled of [-0.1, -STRIDE / 2, -STRIDE, -STRIDE * 3.7]) {
      const { frame } = gaitPhase(travelled, STRIDE, FRAMES);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(FRAMES);
    }
  });

  it('sways one full period per cycle', () => {
    expect(gaitPhase(STRIDE / 4, STRIDE, FRAMES).sway).toBeCloseTo(1);
    expect(gaitPhase(STRIDE * 0.75, STRIDE, FRAMES).sway).toBeCloseTo(-1);
    expect(gaitPhase(STRIDE, STRIDE, FRAMES).sway).toBeCloseTo(0);
  });
});

describe('robotGaitSprites', () => {
  // `frame` is in the *shipped* texture's pixel space, so these rectangles are the
  // one thing in config/sprites.ts coupled to a `size` in scripts/encode-sprites.mjs.
  // Nothing else would catch the two drifting apart: a wrong quadrant still resolves,
  // it just crops the wrong part of the sheet.
  it.each([Owner.Player, Owner.AI])('slices %s into four quadrants of the shipped sheet', (owner) => {
    const frames = robotGaitSprites[owner]?.legs;
    expect(frames).toHaveLength(FRAMES);
    const q = SHEET_PX / 2;
    // Reading order — the gait cycle depends on it, unlike the decal sheets.
    expect(frames?.map((f) => f.frame)).toEqual([
      { x: 0, y: 0, w: q, h: q },
      { x: q, y: 0, w: q, h: q },
      { x: 0, y: q, w: q, h: q },
      { x: q, y: q, w: q, h: q },
    ]);
    // Cells are units authored facing up, not orientation-free decals.
    expect(frames?.every((f) => f.rotationOffset === Math.PI / 2)).toBe(true);
  });
});
