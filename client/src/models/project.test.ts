import { describe, expect, it } from 'vitest';
import { box, horizonOf, perspective, project, turntable, modelBounds, ROBOT_MODELS } from './index';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * The projection's own arithmetic, without a camera rig or a renderer around it.
 * The FPV half of this — that "right" on screen is the driver's right, and that what
 * is behind the hull is behind the near plane — is checked against the real camera
 * in `pixi/render/fpv/camera.test.ts`, since that is where the pose comes from.
 */

const W = 800;
const H = 600;
const level = { eye: { x: 0, y: 0, z: 0 }, heading: 0, pitch: 0, fovDeg: 60, near: 1, screenW: W, screenH: H };

describe('perspective', () => {
  it('puts what is dead ahead in the middle of the screen', () => {
    const p = project(perspective(level), 100, 0, 0);
    expect(p?.x).toBeCloseTo(W / 2, 4);
    expect(p?.y).toBeCloseTo(H / 2, 4);
  });

  it('reports how far in front of the camera a point is', () => {
    expect(project(perspective(level), 250, 0, 0)?.depth).toBeCloseTo(250, 4);
  });

  it('rejects everything at or behind the near plane', () => {
    expect(project(perspective(level), 0, 0, 0)).toBeNull();
    expect(project(perspective(level), -100, 0, 0)).toBeNull();
    expect(project(perspective(level), level.near / 2, 0, 0)).toBeNull();
  });

  it('carries the viewport inside the matrix, where every consumer can use it', () => {
    // Pixels, not clip space — so the same point lands twice as far right on a
    // canvas twice as wide, without the caller doing the mapping itself.
    const wide = project(perspective({ ...level, screenW: W * 2 }), 100, 20, 0);
    const narrow = project(perspective(level), 100, 20, 0);
    expect(wide?.x).toBeGreaterThan(narrow?.x ?? 0);
  });

  it('shrinks what it draws as the field of view opens', () => {
    const tight = project(perspective({ ...level, fovDeg: 30 }), 100, 20, 0);
    const wide = project(perspective({ ...level, fovDeg: 90 }), 100, 20, 0);
    expect(Math.abs((tight?.x ?? 0) - W / 2)).toBeGreaterThan(Math.abs((wide?.x ?? 0) - W / 2));
  });
});

describe('horizonOf', () => {
  it('is where a far-off point at eye height lands', () => {
    const pitch = 0.3;
    const view = perspective({ ...level, pitch, eye: { x: 0, y: 0, z: 50 } });
    const far = project(view, 200000, 0, 50);
    expect(far?.y).toBeCloseTo(horizonOf(pitch, level.fovDeg, H), 1);
  });

  it('sits above the middle of the screen for a camera tilted down', () => {
    expect(horizonOf(0.3, 60, H)).toBeLessThan(H / 2);
    expect(horizonOf(0, 60, H)).toBeCloseTo(H / 2, 6);
  });
});

describe('turntable', () => {
  const model = ROBOT_MODELS[ChassisType.Tracks][WeaponType.Cannon];

  it('stands the camera in front of the machine at a spin of zero', () => {
    // "Spin" is a bearing round the machine, not the camera's own heading — 0 is
    // dead ahead of it, which is what a caller animating a preview is thinking in.
    const view = turntable(model, { width: 200, height: 200 });
    expect(view.eye.x).toBeGreaterThan(modelBounds(model).x.max);
  });

  it('walks the camera round toward the machine’s right as the spin opens', () => {
    const quarter = turntable(model, { width: 200, height: 200, spin: Math.PI / 2 });
    expect(quarter.eye.y).toBeGreaterThan(0);
    expect(quarter.eye.x).toBeCloseTo(modelCentreX(), 0);
  });

  it('looks down at the machine rather than up at it', () => {
    const view = turntable(model, { width: 200, height: 200 });
    expect(view.eye.z).toBeGreaterThan(modelBounds(model).z.max);
  });

  it('pulls further back for a bigger machine', () => {
    const small = turntable(box(10, 10, 0, 10), { width: 200, height: 200 });
    const large = turntable(box(200, 200, 0, 200), { width: 200, height: 200 });
    expect(large.eye.x).toBeGreaterThan(small.eye.x);
  });

  it('pulls further back for a narrow panel, where the horizontal fit is the tighter one', () => {
    const square = turntable(model, { width: 200, height: 200 });
    const narrow = turntable(model, { width: 80, height: 200 });
    expect(Math.abs(narrow.eye.x)).toBeGreaterThan(Math.abs(square.eye.x));
  });

  it('keeps a point of the machine in front of the near plane', () => {
    const view = turntable(model, { width: 200, height: 200 });
    expect(project(view, 0, 0, modelBounds(model).z.max)).not.toBeNull();
  });

  function modelCentreX(): number {
    const b = modelBounds(model);
    return (b.x.min + b.x.max) / 2;
  }
});
