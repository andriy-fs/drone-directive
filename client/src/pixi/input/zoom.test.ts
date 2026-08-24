import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { pinchFactor, zoomFactorFromWheel } from './zoom';

const { wheelZoomStep } = gameConfig.camera;

describe('zoomFactorFromWheel', () => {
  it('zooms in on a scroll up and out on a scroll down', () => {
    expect(zoomFactorFromWheel(-100, 0, false)).toBeGreaterThan(1);
    expect(zoomFactorFromWheel(100, 0, false)).toBeLessThan(1);
  });

  it('applies exactly one configured step per wheel notch', () => {
    expect(zoomFactorFromWheel(-100, 0, false)).toBeCloseTo(wheelZoomStep, 10);
    expect(zoomFactorFromWheel(100, 0, false)).toBeCloseTo(1 / wheelZoomStep, 10);
  });

  it('is symmetric, so scrolling back lands on the zoom it started from', () => {
    expect(zoomFactorFromWheel(-40, 0, false) * zoomFactorFromWheel(40, 0, false)).toBeCloseTo(1, 10);
    expect(zoomFactorFromWheel(-40, 0, true) * zoomFactorFromWheel(40, 0, true)).toBeCloseTo(1, 10);
  });

  it('normalises line and page deltas, so Firefox does not get a different step', () => {
    // deltaMode 1 reports lines (16 px each): 6.25 lines is the 100 px notch.
    expect(zoomFactorFromWheel(-6.25, 1, false)).toBeCloseTo(wheelZoomStep, 10);
    // deltaMode 2 reports pages (800 px each).
    expect(zoomFactorFromWheel(-0.125, 2, false)).toBeCloseTo(wheelZoomStep, 10);
  });

  it('reads a ctrl-wheel as a trackpad pinch, which is far gentler per pixel', () => {
    const wheel = zoomFactorFromWheel(-100, 0, false);
    const pinch = zoomFactorFromWheel(-100, 0, true);
    expect(pinch).toBeGreaterThan(1);
    expect(pinch).not.toBeCloseTo(wheel, 3);
  });

  it('leaves the zoom alone for a delta that says nothing', () => {
    expect(zoomFactorFromWheel(0, 0, false)).toBe(1);
    expect(zoomFactorFromWheel(Number.NaN, 0, false)).toBe(1);
  });
});

describe('pinchFactor', () => {
  it('zooms in as the fingers spread and out as they close', () => {
    expect(pinchFactor(100, 150)).toBeCloseTo(1.5, 10);
    expect(pinchFactor(100, 50)).toBeCloseTo(0.5, 10);
  });

  it('holds the zoom when there is no previous distance to measure against', () => {
    expect(pinchFactor(0, 120)).toBe(1);
    expect(pinchFactor(-1, 120)).toBe(1);
    expect(pinchFactor(Number.NaN, 120)).toBe(1);
  });
});
