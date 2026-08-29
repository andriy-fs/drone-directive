import { describe, expect, it } from 'vitest';
import { at, box, mirrorY, modelBounds, seg } from './index';

/**
 * Placing a part is where a limb stops being six sets of coordinates and becomes one
 * shape put in six places. The thing worth testing is not the arithmetic but the
 * normals: a rotation that moves the geometry and leaves the faces behind culls the
 * parts of a machine that are pointing straight at the camera.
 */

/** Every normal on a convex part must point away from that part's middle. */
function expectOutward(model: ReturnType<typeof box>, centre: readonly [number, number, number]): void {
  for (const s of model) {
    const mid = [(s.x0 + s.x1) / 2 - centre[0], (s.y0 + s.y1) / 2 - centre[1], (s.z0 + s.z1) / 2 - centre[2]];
    for (const n of s.faces ?? []) {
      expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]).toBeGreaterThan(0);
    }
  }
}

describe('at', () => {
  it('moves a part without changing its size', () => {
    const moved = at(box(10, 10, 0, 10), { dx: 20, dy: -5, dz: 3 });
    expect(modelBounds(moved).x).toEqual({ min: 15, max: 25 });
    expect(modelBounds(moved).y).toEqual({ min: -10, max: 0 });
    expect(modelBounds(moved).z).toEqual({ min: 3, max: 13 });
  });

  it('yaws forward round to the right, the way a machine turns on the ground', () => {
    const [turned] = at([seg(10, 0, 0, 10, 0, 0)], { yaw: Math.PI / 2 });
    expect(turned.x0).toBeCloseTo(0, 6);
    expect(turned.y0).toBeCloseTo(10, 6);
  });

  it('pitches nose-down for a positive angle, the way the camera does', () => {
    // Right-handed about y, and the same sense as `project.ts`'s tilt: a barrel is
    // elevated with a negative pitch. The trap this guards is two opposite meanings
    // of the word in one folder.
    const [barrel] = at([seg(0, 0, 0, 10, 0, 0)], { pitch: Math.PI / 2 });
    expect(barrel.z1).toBeCloseTo(-10, 6);
    expect(at([seg(0, 0, 0, 10, 0, 0)], { pitch: -Math.PI / 2 })[0].z1).toBeCloseTo(10, 6);
  });

  it('scales about the part’s own origin before placing it', () => {
    const half = at(box(10, 10, 0, 10), { scale: 0.5, dz: 100 });
    expect(modelBounds(half).x).toEqual({ min: -2.5, max: 2.5 });
    expect(modelBounds(half).z).toEqual({ min: 100, max: 105 });
  });

  it('turns the face normals with the geometry', () => {
    // The invariant culling actually rests on: every normal still points away from
    // the part's own middle after it has been placed. A rotation that moves the
    // geometry and leaves the faces behind fails this, and the machine it belongs
    // to would cull the side that is facing you.
    expectOutward(at(box(10, 10, 0, 10), { yaw: Math.PI / 3, pitch: 0.4, dx: 30, dz: 5 }), [30, 0, 10]);
  });
});

describe('mirrorY', () => {
  it('puts the part on the other side of the centreline', () => {
    const right = at(box(6, 6, 0, 6), { dy: 12 });
    expect(modelBounds(mirrorY(right)).y).toEqual({ min: -15, max: -9 });
  });

  it('flips the normals with it, or the far side of every machine culls itself', () => {
    // A mirror reverses handedness, which is why this is not `at({ scale: -1 })`:
    // left alone, every normal on the mirrored part would point into it.
    const mirrored = mirrorY(box(6, 6, 0, 6, 0, 12));
    expectOutward(mirrored, [0, -12, 3]);
    expect(mirrored.flatMap((s) => s.faces ?? []).filter((n) => n[1] < -0.99).length).toBeGreaterThan(0);
  });
});
