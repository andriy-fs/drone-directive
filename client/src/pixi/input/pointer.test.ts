import { describe, expect, it } from 'vitest';
import { isDrag, shouldHandleMoveKey } from './pointer';

describe('shouldHandleMoveKey', () => {
  it('ignores Ctrl/Cmd combinations so select-all does not pan the camera', () => {
    expect(
      shouldHandleMoveKey({
        code: 'KeyA',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
    expect(
      shouldHandleMoveKey({
        code: 'KeyA',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
  });

  it('keeps plain WASD/arrow movement enabled', () => {
    expect(
      shouldHandleMoveKey({
        code: 'KeyW',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(
      shouldHandleMoveKey({
        code: 'ArrowRight',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
  });
});

describe('isDrag', () => {
  it('holds a mouse to a tight threshold', () => {
    expect(isDrag(100, 100, 102, 101, 'mouse')).toBe(false); // 3 px, a click
    expect(isDrag(100, 100, 105, 100, 'mouse')).toBe(true);
  });

  it('gives a finger far more room, because a tap wanders', () => {
    // The distances in between are the whole point: at the mouse's threshold these
    // register as a tiny marquee, which clears the selection and eats the order the
    // player was giving.
    expect(isDrag(100, 100, 108, 100, 'touch')).toBe(false);
    expect(isDrag(100, 100, 106, 106, 'touch')).toBe(false);
    expect(isDrag(100, 100, 120, 100, 'touch')).toBe(true);
  });

  it('measures both axes together, not the longer one', () => {
    // Manhattan, which is what both thresholds are calibrated against.
    expect(isDrag(0, 0, 3, 3, 'mouse')).toBe(true);
    expect(isDrag(0, 0, 3, 0, 'mouse')).toBe(false);
  });

  it('treats a pen as a mouse — it is a precise pointer', () => {
    expect(isDrag(100, 100, 108, 100, 'pen')).toBe(true);
  });
});
