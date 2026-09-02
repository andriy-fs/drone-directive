import { describe, expect, it } from 'vitest';
import { shouldHandleMoveKey } from './pointer';

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
