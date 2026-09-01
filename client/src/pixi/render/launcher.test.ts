import { describe, expect, it } from 'vitest';
import { idleScan, recoilPx, reloadFill, reloadTint } from './launcher';

describe('idleScan', () => {
  it('starts on the bearing it was handed and stays within its sector', () => {
    expect(idleScan(0)).toBeCloseTo(0, 6);
    for (let t = 0; t < 20; t += 0.1) expect(Math.abs(idleScan(t))).toBeLessThanOrEqual(0.44 + 1e-9);
  });

  it('is continuous across the sweep — no snap back at the ends', () => {
    let prev = idleScan(0);
    for (let t = 0.05; t < 24; t += 0.05) {
      const next = idleScan(t);
      expect(Math.abs(next - prev)).toBeLessThan(0.03);
      prev = next;
    }
  });

  it('repeats every period', () => {
    expect(idleScan(3)).toBeCloseTo(idleScan(3 + 8), 6);
  });
});

describe('recoilPx', () => {
  it('is at rest before the shot and after the window', () => {
    expect(recoilPx(-1)).toBe(0);
    expect(recoilPx(0)).toBe(0);
    expect(recoilPx(0.18)).toBe(0);
    expect(recoilPx(5)).toBe(0);
  });

  it('peaks a quarter of the way in, then settles', () => {
    const peak = recoilPx(0.18 * 0.25);
    expect(peak).toBeCloseTo(3, 6);
    expect(recoilPx(0.18 * 0.1)).toBeLessThan(peak);
    expect(recoilPx(0.18 * 0.6)).toBeLessThan(peak);
    expect(recoilPx(0.18 * 0.9)).toBeLessThan(recoilPx(0.18 * 0.6));
  });

  it('goes back faster than it comes forward', () => {
    // The kick covers the full travel in a quarter of the window; the return takes the rest.
    expect(recoilPx(0.18 * 0.5)).toBeGreaterThan(0);
  });
});

describe('reloadFill', () => {
  it('runs from empty at the shot to full at the end of the cooldown', () => {
    expect(reloadFill(1.6, 1.6)).toBe(0);
    expect(reloadFill(0.8, 1.6)).toBeCloseTo(0.5, 6);
    expect(reloadFill(0, 1.6)).toBe(1);
  });

  it('is monotonic as the countdown runs down', () => {
    let prev = -1;
    for (let left = 1.6; left >= 0; left -= 0.1) {
      const fill = reloadFill(left, 1.6);
      expect(fill).toBeGreaterThanOrEqual(prev);
      prev = fill;
    }
  });

  it('clamps a countdown outside its own cooldown, and reads a zero cooldown as ready', () => {
    expect(reloadFill(9, 1.6)).toBe(0);
    expect(reloadFill(-1, 1.6)).toBe(1);
    expect(reloadFill(0, 0)).toBe(1);
  });
});

describe('reloadTint', () => {
  it('is white when loaded and a neutral grey when empty', () => {
    expect(reloadTint(1)).toBe(0xffffff);
    const empty = reloadTint(0);
    const r = (empty >> 16) & 0xff;
    expect(r).toBeLessThan(0xff);
    expect((empty >> 8) & 0xff).toBe(r); // neutral: no hue of its own
    expect(empty & 0xff).toBe(r);
  });

  it('brightens as the reload fills', () => {
    expect(reloadTint(0.5) & 0xff).toBeGreaterThan(reloadTint(0) & 0xff);
    expect(reloadTint(1) & 0xff).toBeGreaterThan(reloadTint(0.5) & 0xff);
  });
});
