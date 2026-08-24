import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { Camera, anchorShift, clampAxis } from './Camera';

/**
 * A camera needs no renderer — its whole job is a transform on a Container — so
 * the class itself is exercised here rather than only the arithmetic under it.
 */
function cameraAt(zoomSteps: number[] = []): Camera {
  const camera = new Camera(new Container());
  camera.setViewport(980, 800);
  camera.centerOn(640, 640);
  for (const factor of zoomSteps) camera.zoomAt(factor, 300, 400);
  return camera;
}

describe('Camera.zoomAt', () => {
  it('leaves the world point under the anchor exactly where it was', () => {
    const camera = cameraAt();
    const before = camera.screenToWorld(300, 400);
    camera.zoomAt(2, 300, 400);
    const after = camera.screenToWorld(300, 400);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(camera.view.scale.x).toBe(2);
  });

  it('stops at the configured range however long the player keeps scrolling', () => {
    expect(cameraAt(Array<number>(30).fill(1.1)).view.scale.x).toBe(2);
    expect(cameraAt(Array<number>(30).fill(1 / 1.1)).view.scale.x).toBe(0.5);
  });

  it('goes back to 1:1 for a new match', () => {
    const camera = cameraAt(Array<number>(8).fill(1.1));
    camera.resetZoom();
    expect(camera.view.scale.x).toBe(1);
  });
});

describe('anchorShift', () => {
  it('keeps the world point under the anchor pinned across a zoom change', () => {
    const origin = 300;
    const anchor = 640;
    const worldUnder = (o: number, z: number) => o + anchor / z;

    const before = worldUnder(origin, 1);
    const after = worldUnder(origin + anchorShift(anchor, 1, 2), 2);
    expect(after).toBeCloseTo(before, 10);
  });

  it('does not move the origin when the anchor is the viewport corner', () => {
    // Screen 0 maps to the origin itself at any scale, so there is nothing to correct.
    expect(anchorShift(0, 1, 2)).toBe(0);
  });

  it('is reversible, so zooming back restores the origin', () => {
    expect(anchorShift(640, 1, 2) + anchorShift(640, 2, 1)).toBeCloseTo(0, 10);
  });
});

describe('clampAxis', () => {
  it('keeps the viewport inside the map', () => {
    expect(clampAxis(-50, 800, 2560)).toBe(0);
    expect(clampAxis(5000, 800, 2560)).toBe(1760);
    expect(clampAxis(400, 800, 2560)).toBe(400);
  });

  it('centres the map once the visible span is wider than the world', () => {
    // 1280 px of world in a 2600 px span: 660 px of margin on each side.
    expect(clampAxis(0, 2600, 1280)).toBe(-660);
    // Wherever the camera was, an oversized span always resolves to the centre.
    expect(clampAxis(900, 2600, 1280)).toBe(-660);
  });

  it('resolves an exact fit to zero rather than a fraction of a pixel', () => {
    expect(clampAxis(123, 1280, 1280)).toBe(0);
  });
});
