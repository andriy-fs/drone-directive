import { describe, expect, it } from 'vitest';
import { shouldHandleDroneFlightKey } from './pointer';

describe('shouldHandleDroneFlightKey', () => {
  it('ignores Ctrl/Cmd combinations so select-all does not drive the drone', () => {
    expect(
      shouldHandleDroneFlightKey({
        code: 'KeyA',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
    expect(
      shouldHandleDroneFlightKey({
        code: 'KeyA',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(false);
  });

  it('keeps plain WASD/arrow movement enabled', () => {
    expect(
      shouldHandleDroneFlightKey({
        code: 'KeyW',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
    expect(
      shouldHandleDroneFlightKey({
        code: 'ArrowRight',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(true);
  });
});
