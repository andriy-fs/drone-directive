import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../../config/gameConfig';
import { FpvCameraRig, fpvEye, viewProjection } from './camera';
import { drawTargetMark } from './units';
import { ROBOT_MODELS, project, screenBoundsOf } from '../../../models';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';

/**
 * The half of this view that is genuinely easy to get backwards: which way is
 * right, and what happens behind the camera. Everything else about the wireframe
 * has to be judged on screen, but a mirrored world and a hull drawn through the
 * near plane both look plausible in a screenshot and are unambiguous here.
 */

const W = 800;
const H = 600;

/** A pose facing east — heading 0 — on flat ground at the origin-ish. */
const facingEast = { x: 1000, y: 1000, heading: 0, ground: 0 };

describe('fpvEye', () => {
  it('sits behind the hull along its heading, and above it', () => {
    const { followDistance, height } = gameConfig.drone.fpv;
    const eye = fpvEye(facingEast);
    expect(eye.x).toBeCloseTo(1000 - followDistance);
    expect(eye.y).toBeCloseTo(1000);
    expect(eye.z).toBeCloseTo(height);
  });

  it('rides the ground it is standing on, so a hull on a slope keeps its camera above it', () => {
    const raised = fpvEye({ ...facingEast, ground: 40 });
    expect(raised.z).toBeCloseTo(gameConfig.drone.fpv.height + 40);
  });
});

describe('project', () => {
  it('puts the hull the camera is following near the centre of the screen', () => {
    const view = viewProjection(facingEast, W, H);
    const p = project(view, facingEast.x, facingEast.y, 0);
    expect(p).not.toBeNull();
    expect(p?.x).toBeCloseTo(W / 2, 0);
    // Below centre: the camera rides above the ground and tilts down, so the patch
    // of ground the hull stands on is in the lower half of the picture.
    expect(p?.y).toBeGreaterThan(H / 2);
  });

  it("maps the driver's right to the right of the screen", () => {
    const view = viewProjection(facingEast, W, H);
    // Facing east, the driver's right is south — which is +y, since the map's y
    // runs down. This is the assertion that catches a mirrored world.
    const right = project(view, facingEast.x, facingEast.y + 200, 0);
    const left = project(view, facingEast.x, facingEast.y - 200, 0);
    expect(right?.x).toBeGreaterThan(W / 2);
    expect(left?.x).toBeLessThan(W / 2);
  });

  it('holds that under an arbitrary heading', () => {
    const heading = Math.PI / 3;
    const pose = { x: 500, y: 700, heading, ground: 0 };
    const view = viewProjection(pose, W, H);
    // 90° clockwise of the heading, one hundred px out.
    const right = project(view, pose.x - Math.sin(heading) * 100, pose.y + Math.cos(heading) * 100, 0);
    expect(right?.x).toBeGreaterThan(W / 2);
  });

  it('puts what is ahead above what is underfoot', () => {
    const view = viewProjection(facingEast, W, H);
    const near = project(view, facingEast.x + 100, facingEast.y, 0);
    const far = project(view, facingEast.x + 900, facingEast.y, 0);
    expect(far?.y).toBeLessThan(near?.y ?? 0);
    expect(far?.depth).toBeGreaterThan(near?.depth ?? 0);
  });

  it('rejects everything at or behind the near plane', () => {
    const view = viewProjection(facingEast, W, H);
    // Well behind the camera, which itself sits behind the hull.
    expect(project(view, facingEast.x - 500, facingEast.y, 0)).toBeNull();
    // And exactly at the eye, where the divide would blow up.
    expect(project(view, view.eye.x, view.eye.y, view.eye.z)).toBeNull();
  });

  it('carries the viewport inside the matrix, where both consumers can use it', () => {
    const view = viewProjection(facingEast, W, H);
    const m = view.matrix;
    const [x, y, z] = [facingEast.x + 300, facingEast.y + 40, 12];
    const row = (i: number) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i];

    // The GPU side cannot do anything else: it hands `xy` and `w` to Pixi's own
    // transform chain and the rasteriser divides. So a matrix that produced clip
    // space would put the ground somewhere else entirely while `project` quietly
    // compensated on the CPU — which is exactly the shape of the bug that made the
    // wireframe ground drift off the machines standing on it.
    const p = project(view, x, y, z);
    expect(p?.x).toBeCloseTo(row(0) / row(3), 6);
    expect(p?.y).toBeCloseTo(row(1) / row(3), 6);
  });

  it('agrees with the matrix the shader is handed — one projection, not two', () => {
    const view = viewProjection(facingEast, W, H);
    expect(view.matrix).toHaveLength(16);
    // Column-major: the translation column is the last four, and it is not the
    // identity's — a matrix built row-major would put the eye offset in the wrong
    // place and every unit would draw somewhere the terrain is not.
    const m = view.matrix;
    expect(m[15]).toBeCloseTo(-(m[2] * view.eye.x + m[6] * view.eye.y + m[10] * view.eye.z));
  });
});

describe('FpvCameraRig', () => {
  const still = { pose: facingEast, dt: 1 / 60, drive: 0, shot: false, hit: 0, screenW: W, screenH: H };
  /** How far behind the hull the eye ended up — the one number every effect here moves. */
  const trail = (rig: FpvCameraRig, over: Partial<typeof still> = {}) => {
    const view = rig.frame({ ...still, ...over });
    return facingEast.x - view.eye.x;
  };

  it('opens already settled rather than easing in from nothing', () => {
    // Taking a hull that is already at speed must not start with the camera
    // sliding backwards into place — the first frame has no history to ease from.
    const rig = new FpvCameraRig();
    const first = trail(rig, { drive: 1 });
    expect(first).toBeCloseTo(trail(rig, { drive: 1 }), 5);
    // And it is genuinely further back than a parked hull's camera.
    expect(first).toBeGreaterThan(facingEast.x - fpvEye(facingEast).x);
  });

  it('falls back as the hull opens the throttle and comes in again when it stops', () => {
    const rig = new FpvCameraRig();
    const parked = trail(rig);
    for (let i = 0; i < 120; i++) trail(rig, { drive: 1 });
    const running = trail(rig, { drive: 1 });
    expect(running).toBeGreaterThan(parked);
    for (let i = 0; i < 120; i++) trail(rig);
    expect(trail(rig)).toBeCloseTo(parked, 0);
  });

  it('shoves the camera back on a shot and settles it', () => {
    const rig = new FpvCameraRig();
    const resting = trail(rig);
    const kicked = trail(rig, { shot: true });
    expect(kicked).toBeGreaterThan(resting + 10);
    for (let i = 0; i < 90; i++) trail(rig);
    expect(trail(rig)).toBeCloseTo(resting, 0);
  });

  it('rings the tube when the hull is hit, and stops', () => {
    const rig = new FpvCameraRig();
    trail(rig);
    const heights: number[] = [];
    rig.frame({ ...still, hit: 0.3 });
    for (let i = 0; i < 40; i++) heights.push(rig.frame(still).eye.z);
    const early = Math.max(...heights.slice(0, 8).map((z) => Math.abs(z - heights[heights.length - 1])));
    const late = Math.max(...heights.slice(-8).map((z) => Math.abs(z - heights[heights.length - 1])));
    expect(early).toBeGreaterThan(1);
    expect(late).toBeLessThan(early / 3);
  });

  it('settles the same way whatever the frame rate', () => {
    // `1 − exp(−dt/τ)` rather than a per-frame multiplier: the same wall-clock
    // second has to land in the same place at 30 fps and at 144.
    const slow = new FpvCameraRig();
    const fast = new FpvCameraRig();
    trail(slow, { dt: 1 / 30 });
    trail(fast, { dt: 1 / 144 });
    for (let i = 0; i < 15; i++) trail(slow, { dt: 1 / 30, drive: 1 });
    for (let i = 0; i < 72; i++) trail(fast, { dt: 1 / 144, drive: 1 });
    expect(trail(slow, { dt: 1 / 30, drive: 1 })).toBeCloseTo(trail(fast, { dt: 1 / 144, drive: 1 }), 0);
  });

  it('forgets everything when the pilot takes a different hull', () => {
    const rig = new FpvCameraRig();
    trail(rig);
    const kicked = trail(rig, { shot: true });
    rig.reset();
    expect(trail(rig)).toBeLessThan(kicked - 10);
  });

  /** Which way the view is pointing: the eye sits on the axis it looks down. */
  const looking = (rig: FpvCameraRig, pose: typeof facingEast, over: Partial<typeof still> = {}) => {
    const view = rig.frame({ ...still, pose, ...over });
    return Math.atan2(pose.y - view.eye.y, pose.x - view.eye.x);
  };

  it('swings after the hull rather than with it', () => {
    const rig = new FpvCameraRig();
    looking(rig, facingEast); // settled, pointing east
    const turned = { ...facingEast, heading: Math.PI / 2 };
    const first = looking(rig, turned);
    // A quarter turn in one frame: the view has begun to come round and is
    // nowhere near arrived.
    expect(first).toBeGreaterThan(0.01);
    expect(first).toBeLessThan(Math.PI / 2 - 0.2);
    for (let i = 0; i < 120; i++) looking(rig, turned);
    expect(looking(rig, turned)).toBeCloseTo(Math.PI / 2, 3);
  });

  it('takes the short way round the back', () => {
    // Just south of due west to just north of it: one degree of hull, and the view
    // must not sweep 359 the other way to follow it.
    const rig = new FpvCameraRig();
    const west = { ...facingEast, heading: Math.PI - 0.01 };
    looking(rig, west);
    const over = { ...facingEast, heading: -Math.PI + 0.01 };
    for (let i = 0; i < 5; i++) looking(rig, over);
    const at = looking(rig, over);
    expect(Math.abs(at)).toBeGreaterThan(Math.PI - 0.05); // still pointing west
  });

  it('opens pointed at the hull it was just given', () => {
    // Taking a machine that faces west must not start with half a second of sweep
    // from wherever the last one was looking.
    const rig = new FpvCameraRig();
    looking(rig, facingEast);
    rig.reset();
    const west = { ...facingEast, heading: Math.PI };
    expect(Math.abs(looking(rig, west))).toBeCloseTo(Math.PI, 5);
  });

  it('swings the same way whatever the frame rate', () => {
    const slow = new FpvCameraRig();
    const fast = new FpvCameraRig();
    looking(slow, facingEast, { dt: 1 / 30 });
    looking(fast, facingEast, { dt: 1 / 144 });
    const turned = { ...facingEast, heading: 1 };
    for (let i = 0; i < 6; i++) looking(slow, turned, { dt: 1 / 30 });
    for (let i = 0; i < 29; i++) looking(fast, turned, { dt: 1 / 144 });
    expect(looking(slow, turned, { dt: 1 / 30 })).toBeCloseTo(looking(fast, turned, { dt: 1 / 144 }), 1);
  });
});

describe('the horizon', () => {
  it('is where a far-off point at eye height lands', () => {
    const view = viewProjection(facingEast, W, H);
    const far = project(view, view.eye.x + 1e6, view.eye.y, view.eye.z);
    expect(far).not.toBeNull();
    expect(far?.y).toBeCloseTo(view.horizonY, 2);
  });

  it('is the same line whichever way the camera faces', () => {
    // Screen right has no z component, so the horizon cannot tilt or shift with a
    // turn — which is what lets it be one number instead of a line.
    const east = viewProjection(facingEast, W, H);
    const other = viewProjection({ ...facingEast, heading: 2.1 }, W, H);
    expect(other.horizonY).toBeCloseTo(east.horizonY, 6);
  });

  it('sits above the middle of the screen, where a tilted-down camera puts it', () => {
    const view = viewProjection(facingEast, W, H);
    expect(view.horizonY).toBeGreaterThan(0);
    expect(view.horizonY).toBeLessThan(H / 2);
  });

  it('drops when the muzzle climbs on recoil', () => {
    const rig = new FpvCameraRig();
    const input = { pose: facingEast, dt: 1 / 60, drive: 0, shot: false, hit: 0, screenW: W, screenH: H };
    const resting = rig.frame(input).horizonY;
    const kicked = rig.frame({ ...input, shot: true }).horizonY;
    // Less downward tilt puts the vanishing line further down the screen.
    expect(kicked).toBeGreaterThan(resting);
  });
});

describe('screenBoundsOf', () => {
  /** A hull sitting on flat ground a little way in front of the camera. */
  const pose = { x: facingEast.x + 260, y: facingEast.y, z: 0, heading: 0 };
  const model = ROBOT_MODELS[ChassisType.Tracks][WeaponType.Cannon];

  it('boxes the machine where the machine is drawn', () => {
    const view = viewProjection(facingEast, W, H);
    const bounds = screenBoundsOf(view, model, pose);
    expect(bounds).not.toBeNull();
    // The target brackets hang off this, so a box that missed the machine would put
    // the mark somewhere the pilot is not looking.
    const centre = project(view, pose.x, pose.y, pose.z + 8);
    expect(centre?.x).toBeGreaterThan(bounds?.minX ?? 0);
    expect(centre?.x).toBeLessThan(bounds?.maxX ?? 0);
    expect(centre?.y).toBeGreaterThan(bounds?.minY ?? 0);
    expect(centre?.y).toBeLessThan(bounds?.maxY ?? 0);
  });

  it('shrinks as the machine goes away', () => {
    const view = viewProjection(facingEast, W, H);
    const near = screenBoundsOf(view, model, pose);
    const far = screenBoundsOf(view, model, { ...pose, x: facingEast.x + 900 });
    const width = (b: { minX: number; maxX: number } | null) => (b ? b.maxX - b.minX : 0);
    expect(width(far)).toBeLessThan(width(near) / 2);
  });

  it('gives nothing for a machine entirely behind the camera', () => {
    const view = viewProjection(facingEast, W, H);
    expect(screenBoundsOf(view, model, { ...pose, x: facingEast.x - 900 })).toBeNull();
  });
});

describe('drawTargetMark', () => {
  /**
   * A stand-in for the `Graphics` the view strokes into — the bracket is geometry,
   * and geometry is checkable without a GPU. What matters is that the four marks
   * really are corner brackets: open in the middle, so the machine inside them is
   * still readable as a machine.
   */
  const recorder = () => {
    const moves: { x: number; y: number }[] = [];
    const lines: { x: number; y: number }[] = [];
    const g = {
      moveTo(x: number, y: number) {
        moves.push({ x, y });
        return g;
      },
      lineTo(x: number, y: number) {
        lines.push({ x, y });
        return g;
      },
      stroke() {
        return g;
      },
    };
    return { g, moves, lines };
  };

  it('hangs four brackets on the corners and leaves the middle open', () => {
    const { g, moves, lines } = recorder();
    drawTargetMark(g as unknown as Parameters<typeof drawTargetMark>[0], { minX: 100, minY: 100, maxX: 200, maxY: 160 }, 1);

    // One bracket per corner, each an elbow: a move and two lines.
    expect(moves).toHaveLength(4);
    expect(lines).toHaveLength(8);
    // Every point stays outside the machine's own box, so the mark never draws
    // across the contour it is pointing at.
    const inside = [...moves, ...lines].filter((p) => p.x > 105 && p.x < 195 && p.y > 105 && p.y < 155);
    expect(inside).toHaveLength(0);
  });

  it('gives a distant machine a mark that is still a mark', () => {
    const { g, moves, lines } = recorder();
    // A hull at the far end of a launcher's reach projects to a couple of pixels;
    // brackets scaled straight off that would be invisible.
    drawTargetMark(g as unknown as Parameters<typeof drawTargetMark>[0], { minX: 400, minY: 300, maxX: 402, maxY: 301 }, 1);
    const xs = [...moves, ...lines].map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(12);
  });
});
