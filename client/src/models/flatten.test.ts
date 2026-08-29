import { describe, expect, it } from 'vitest';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import {
  BASE_BODY,
  BASE_LAUNCHER,
  DRONE_MODEL,
  MUNITION_MODEL,
  PROJECTILE_MODEL,
  ROBOT_MODELS,
  box,
  detail,
  flatten,
  perspective,
  ring,
  seg,
  turntable,
  type Flat,
  type Model,
} from './index';

/**
 * The step both renderers share, and the only place in this layer that knows where
 * a machine is standing.
 *
 * The last test here is the one this layer was extracted to make possible. A
 * forgotten or malformed model makes a unit *invisible* to anyone in a hull, and
 * no rendering test could catch that while the projection needed a GPU. It does not
 * any more, so every machine in the game can be put through a camera and checked.
 */

const AHEAD = { x: 0, y: 0, z: 0, heading: 0 };
const camera = perspective({
  eye: { x: -200, y: 0, z: 20 },
  heading: 0,
  pitch: 0,
  fovDeg: 60,
  near: 1,
  screenW: 400,
  screenH: 400,
});

const drawn = (out: Flat[], count: number) => out.slice(0, count).filter((f) => f.ok);

describe('flatten', () => {
  it('writes one entry per segment and says how many', () => {
    const out: Flat[] = [];
    const model = box(20, 20, 0, 20);
    expect(flatten(out, model, AHEAD, camera)).toBe(model.length);
    expect(out).toHaveLength(model.length);
  });

  it('stays index-aligned with the model, so a caller can make several passes', () => {
    // A clipped segment is written with `ok: false` rather than skipped: the hull
    // view projects once and reads the buffer three times (structure, then the hot
    // nodes over it), and a compacted buffer would put those passes out of step.
    const out: Flat[] = [];
    const model: Model = [seg(0, 0, 0, 10, 0, 0), seg(-1000, 0, 0, -900, 0, 0)];
    flatten(out, model, AHEAD, camera);
    expect(out[0].ok).toBe(true);
    expect(out[1].ok).toBe(false);
  });

  it('reuses the caller’s buffer instead of allocating per machine per frame', () => {
    const out: Flat[] = [];
    flatten(out, box(20, 20, 0, 20), AHEAD, camera);
    const first = out[0];
    flatten(out, box(30, 30, 0, 30), AHEAD, camera);
    expect(out[0]).toBe(first);
  });

  it('rotates the model onto the machine’s heading', () => {
    // Local +x is forward. A machine facing south (heading π/2, since the map's y
    // runs down) has its nose to the south, not to the east.
    const out: Flat[] = [];
    const nose: Model = [seg(0, 0, 0, 40, 0, 0)];
    const overhead = perspective({
      eye: { x: 0, y: 0, z: 300 },
      heading: 0,
      pitch: Math.PI / 2,
      fovDeg: 60,
      near: 1,
      screenW: 400,
      screenH: 400,
    });
    flatten(out, nose, { x: 0, y: 0, z: 0, heading: Math.PI / 2 }, overhead);
    // Looking straight down with the camera's heading due east, the driver's right
    // is south and south is screen right: a southward nose runs off to the right.
    expect(out[0].bx).toBeGreaterThan(out[0].ax);
    expect(out[0].by).toBeCloseTo(out[0].ay, 4);
  });

  it('drops a segment when either end is behind the camera, never half of one', () => {
    // `project` clips rather than intersects, so half a projected segment is a line
    // to a point the model never had.
    const out: Flat[] = [];
    const throughTheLens: Model = [seg(-400, 0, 0, 400, 0, 0)];
    flatten(out, throughTheLens, AHEAD, camera);
    expect(out[0].ok).toBe(false);
  });

  it('carries the node mark through, so a heat pass needs no second look at the model', () => {
    const out: Flat[] = [];
    flatten(out, ROBOT_MODELS[ChassisType.Tracks][WeaponType.Cannon], AHEAD, camera);
    expect(out.some((f) => f.node === 'barrel')).toBe(true);
  });
});

describe('the detail tier', () => {
  const model: Model = [...box(20, 20, 0, 20), ...detail(1, box(6, 6, 20, 24))];

  it('leaves the fine detail out by default', () => {
    const out: Flat[] = [];
    const count = flatten(out, model, AHEAD, camera);
    expect(drawn(out, count)).toHaveLength(12);
  });

  it('draws it when a caller asks for it — which a preview panel always does', () => {
    const out: Flat[] = [];
    const count = flatten(out, model, AHEAD, camera, { maxLod: 1 });
    expect(drawn(out, count)).toHaveLength(24);
  });
});

describe('hidden lines', () => {
  const solid = box(40, 40, 0, 40);

  it('draws everything when the caller has not asked for culling', () => {
    // Off by default, deliberately: a model whose primitives carry no normals would
    // be drawn identically either way, so switching this on is a statement that the
    // models in question have been tagged.
    const out: Flat[] = [];
    const count = flatten(out, solid, AHEAD, camera);
    expect(drawn(out, count)).toHaveLength(solid.length);
  });

  it('drops the far side of a solid when it has', () => {
    const out: Flat[] = [];
    const count = flatten(out, solid, AHEAD, camera, { cull: true });
    const kept = drawn(out, count);
    expect(kept.length).toBeLessThan(solid.length);
    expect(kept.length).toBeGreaterThan(0);
  });

  it('keeps every edge that borders one face still turned toward the camera', () => {
    // The rule is "any", not "all". The bottom-front edge of a hull borders the
    // floor — which is hidden — and the front, which is not; culling it would take
    // the bottom off every machine in the game and leave them floating.
    const out: Flat[] = [];
    const count = flatten(out, solid, AHEAD, camera, { cull: true });
    // The camera sits west of the model, so the face turned toward it is x = −20:
    // its two horizontal edges and its two uprights, all four still drawn.
    const nearFace = out
      .slice(0, count)
      .filter((f, i) => f.ok && solid[i].x0 === -20 && solid[i].x1 === -20);
    expect(nearFace).toHaveLength(4);
  });

  it('never culls a rim, a spoke or anything else that is a line rather than a surface', () => {
    const out: Flat[] = [];
    const rim = ring(10, 5, 8);
    const count = flatten(out, rim, AHEAD, camera, { cull: true });
    expect(drawn(out, count)).toHaveLength(rim.length);
  });
});

describe('every machine in the game', () => {
  /** The whole catalogue, named — a preview panel has to be able to show any of them. */
  const catalogue: [string, Model][] = [
    ...Object.values(ChassisType).flatMap((chassis) =>
      Object.values(WeaponType).map(
        (weapon): [string, Model] => [`${chassis}/${weapon}`, ROBOT_MODELS[chassis][weapon]],
      ),
    ),
    ['base body', BASE_BODY],
    ['base launcher', BASE_LAUNCHER],
    ['drone', DRONE_MODEL],
    ['munition', MUNITION_MODEL],
    ['projectile', PROJECTILE_MODEL],
  ];

  const SIZE = 240;

  it.each(catalogue)('frames %s whole, from every side', (name, model) => {
    let widest = 0;
    for (const spin of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      const out: Flat[] = [];
      const view = turntable(model, { width: SIZE, height: SIZE, spin });
      const count = flatten(out, model, AHEAD, view, { maxLod: Infinity });
      const kept = drawn(out, count);

      // Nothing clipped: a preview that has to drop segments is a preview that has
      // outgrown its frame.
      expect(kept.length, `${name} @ ${spin}`).toBe(model.length);

      const xs = kept.flatMap((f) => [f.ax, f.bx]);
      const ys = kept.flatMap((f) => [f.ay, f.by]);
      expect(Math.min(...xs), `${name} @ ${spin}`).toBeGreaterThanOrEqual(0);
      expect(Math.min(...ys), `${name} @ ${spin}`).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs), `${name} @ ${spin}`).toBeLessThanOrEqual(SIZE);
      expect(Math.max(...ys), `${name} @ ${spin}`).toBeLessThanOrEqual(SIZE);

      widest = Math.max(widest, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }

    // And from *some* angle it fills the frame it was given. This is the assertion
    // that catches an empty or half-written model, which is the failure this layer
    // pays for by having no art pipeline at all. From some angle rather than from
    // every one, because a tracer really is a dash seen end-on, and pretending
    // otherwise would only mean a threshold low enough to catch nothing.
    expect(widest / SIZE, name).toBeGreaterThan(0.4);
  });
});
