import { describe, expect, it } from 'vitest';
import { box, detail, frustum, modelBounds, plate, prism, ring, tube, wheel } from './index';

/**
 * What a primitive owes its callers: the shape it claims, standing where it claims
 * to stand, with face normals that point *out*. The last one is the half nobody
 * would notice going wrong until a hidden-line pass turned a hull inside out, which
 * is exactly the kind of failure a wireframe hides well.
 */

/** Every normal a shape carries, flattened out of its edges. */
const normals = (model: ReturnType<typeof box>) => model.flatMap((s) => s.faces ?? []);

describe('faces', () => {
  it('gives a box a normal per face and points them away from its middle', () => {
    // A cube on the origin: a normal is outward exactly when it agrees in sign with
    // the corner it belongs to, which for a centred box is the coordinate itself.
    for (const s of box(20, 20, -10, 10)) {
      const mid = [(s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2];
      expect(s.faces, 'every edge of a solid borders faces').toBeDefined();
      for (const n of s.faces ?? []) {
        const alongTheNormal = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2];
        expect(alongTheNormal).toBeGreaterThan(0);
      }
    }
  });

  it('gives every edge of a box two of them', () => {
    // The "any face still showing" rule is the whole reason the field is a list: an
    // edge with one normal is an edge that vanishes while you are looking at it.
    for (const s of box(10, 10, 0, 10)) expect(s.faces).toHaveLength(2);
  });

  it('leaves a lone plate and a rim untagged, so nothing can cull them', () => {
    // A belt line, a wheel rim and a coil are lines rather than the borders of a
    // surface; culling them by a normal they never had would be a hole in a machine.
    for (const s of [...plate(10, 10, 0), ...ring(6, 0, 8), ...wheel(0, 0, 6, 6)]) {
      expect(s.faces).toBeUndefined();
    }
  });

  it("leaves a tube's mouth untagged and tags its length", () => {
    const t = tube(20, 6, 0, 6, 0, 0);
    // Four longitudinal edges carry faces; the mouth is the tube's identity and is
    // drawn from every angle.
    expect(t.filter((s) => s.faces).length).toBe(4);
  });

  it('tilts a frustum’s normals up as its sides slope in', () => {
    // A hull narrowing toward the top faces partly skyward, and this is the one
    // place a hand-written normal would be guessed wrong.
    const slanted = frustum({ len: 20, wid: 20 }, { len: 8, wid: 8 }, 0, 10);
    const up = normals(slanted).filter((n) => n[2] > 0.1 && (n[0] !== 0 || n[1] !== 0));
    expect(up.length).toBeGreaterThan(0);
    // A straight-sided box has no such normal: its sides are vertical.
    expect(normals(box(20, 20, 0, 10)).some((n) => n[2] > 0.1 && (n[0] !== 0 || n[1] !== 0))).toBe(false);
  });
});

describe('the shapes themselves', () => {
  it('stands a wheel on the ground rather than hovering over it', () => {
    // A polygon started at angle zero has its lowest corner short of the ground,
    // and a wheel visibly floating is the one flaw a wireframe cannot hide.
    expect(modelBounds(wheel(0, 0, 6.5, 6)).z.min).toBeCloseTo(0, 6);
  });

  it('builds a prism of the radius asked for, at the height asked for', () => {
    const p = prism(10, 2, 8, 6);
    const b = modelBounds(p);
    expect(b.z).toEqual({ min: 2, max: 8 });
    expect(b.x.max).toBeCloseTo(10, 6);
    // A ring at each end plus an upright per vertex.
    expect(p).toHaveLength(6 * 3);
  });

  it('tapers a frustum between the two footprints it is given', () => {
    const f = frustum({ len: 30, wid: 20 }, { len: 10, wid: 10 }, 0, 12);
    const b = modelBounds(f);
    expect(b.x).toEqual({ min: -15, max: 15 });
    expect(b.z).toEqual({ min: 0, max: 12 });
  });
});

describe('detail', () => {
  it('stamps a tier over a group without touching what it is made of', () => {
    const greebles = detail(1, plate(6, 6, 4));
    expect(greebles.every((s) => s.lod === 1)).toBe(true);
    expect(modelBounds(greebles)).toEqual(modelBounds(plate(6, 6, 4)));
  });
});
