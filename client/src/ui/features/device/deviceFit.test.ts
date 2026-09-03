import { describe, expect, it } from 'vitest';
import { DeviceFit, deviceFit } from './deviceFit';

/**
 * The thresholds are a product decision, so these read as the device table they
 * came from (`.docs/internal/tasks/support-tablets/README.md` § 4) rather than as
 * arithmetic. The heights are *viewport* heights — screen height less the browser
 * chrome that measurement deliberately includes — which is the whole reason the
 * bounds sit below the accepted 1133 × 744.
 */

/** Landscape viewports, chrome already taken off the height. */
const landscape = {
  'iPad Pro 12.9"': [1366, 940],
  'iPad Air / Pro 11"': [1194, 750],
  'iPad 10th gen': [1180, 736],
  'Galaxy Tab S9': [1280, 716],
  'iPad mini': [1133, 660],
} as const;

describe('deviceFit', () => {
  it('passes every tablet the game supports, held in landscape', () => {
    for (const [device, [w, h]] of Object.entries(landscape)) {
      expect(deviceFit(w, h), device).toBe(DeviceFit.Ok);
    }
  });

  it('asks a supported tablet stood on its end to rotate, rather than calling it small', () => {
    // The same devices turned 90°: the long side is now vertical and pays the
    // chrome, which is what `LONG_SIDE_MIN` leaves room for.
    expect(deviceFit(744, 1050)).toBe(DeviceFit.Rotate); // iPad mini
    expect(deviceFit(834, 1110)).toBe(DeviceFit.Rotate); // iPad Air
    expect(deviceFit(1024, 1280)).toBe(DeviceFit.Rotate); // iPad Pro 12.9"
  });

  it('calls a phone too small in both orientations, never asking it to rotate', () => {
    // iPhone 15 Pro. Rotating it changes nothing that matters, so the verdict
    // must not change either — otherwise the advice sends the player in a circle.
    expect(deviceFit(393, 780)).toBe(DeviceFit.TooSmall);
    expect(deviceFit(852, 330)).toBe(DeviceFit.TooSmall);
  });

  it('catches an iPad in Split View, where the screen is full-size and the viewport is not', () => {
    // ~570px of width is the case that settled `window` over `window.screen`:
    // by the screen it is an iPad, by what it can draw in it is not.
    expect(deviceFit(570, 1000)).toBe(DeviceFit.TooSmall);
  });

  it('warns a desktop window dragged down to a cramped size', () => {
    expect(deviceFit(700, 700)).toBe(DeviceFit.TooSmall);
    expect(deviceFit(1440, 900)).toBe(DeviceFit.Ok);
  });

  it('treats an exactly-square viewport as landscape, having nothing to gain from a turn', () => {
    expect(deviceFit(1100, 1100)).toBe(DeviceFit.Ok);
  });
});
