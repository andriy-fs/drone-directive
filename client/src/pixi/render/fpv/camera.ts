import { gameConfig } from '../../../config/gameConfig';

/**
 * Where the wireframe view is looking from, and the one matrix everything in it
 * is projected with.
 *
 * **There is exactly one projection in this folder, and it lives here.** The
 * terrain is projected on the GPU and the units on the CPU, which is two code
 * paths — but they are two *consumers* of the same sixteen numbers, never two
 * transcriptions of the same formula. A shader-side copy of this would be right
 * for as long as nobody edited either one, and the failure it eventually produces
 * (hills and machines half a frame apart) is one nobody would think to look for
 * in a shader.
 *
 * Pure: no Pixi, no store, no world. It takes a pose and a viewport and returns
 * numbers, which is what lets `camera.test.ts` check the awkward half — that
 * "right" on screen is the driver's right, and that what is behind the hull is
 * behind the near plane.
 *
 * ## The space
 *
 * The simulation is 2D and its `y` runs **down** the top-down map (south). This
 * view adds a third axis, `z`, running **up** out of the ground, and keeps `x`/`y`
 * exactly as the world has them — so a world position needs no conversion, only a
 * height. The camera basis is then:
 *
 * - `R` — screen right, which is the driver's right: heading turned 90° clockwise
 *   on the map, and clockwise-on-the-map *is* to the right of something facing
 *   along the heading, precisely because `y` points south.
 * - `U` — screen up.
 * - `D` — the view direction, heading tilted down by `pitch`.
 *
 * `R × U = D`, so the triple is right-handed with **+z forward** rather than
 * GL's −z. That is a deliberate simplification: the projection below is written
 * here rather than borrowed, and taking `w = camZ` directly saves a sign that
 * would otherwise have to be right in two places.
 */

/** Where the camera is and what it is looking at — everything `viewProjection` needs. */
export interface FpvPose {
  /** The hull being ridden, in world px. */
  x: number;
  y: number;
  /** Its heading, in radians, exactly as the ECS stores it. */
  heading: number;
  /** Ground height under the hull, in world px (see `terrain.ts`). */
  ground: number;
}

/** The camera's own position in the 3D world, in world px. */
export interface FpvEye {
  x: number;
  y: number;
  z: number;
}

/**
 * A built projection: the matrix, plus the eye it was built from.
 *
 * The eye rides along because the distance fade needs it and deriving it back out
 * of the matrix would be the same duplication this module exists to prevent.
 */
export interface FpvProjection {
  /**
   * World → **canvas pixels**, homogeneous and **column-major** (the order a GLSL
   * `mat4` uniform expects). `xy` come out premultiplied by `w`; divide by `w` and
   * you have the point in CSS pixels from the canvas's top-left.
   *
   * Pixels rather than clip space, deliberately. Both consumers need the pixel
   * position — the CPU one to stroke a `Graphics`, the GPU one to hand Pixi's own
   * `mat3` a point in the container's coordinate space — so if the viewport step
   * were left out of here, each of them would write it out again, and this module
   * exists to stop exactly that.
   */
  matrix: Float32Array;
  eye: FpvEye;
  /** Copied through so `project` can reject what the vertex shader would clip. */
  near: number;
}

/** A point that survived projection, in CSS pixels from the canvas's top-left. */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance in front of the camera along the view direction, in world px. */
  depth: number;
}

/** Where the camera sits for a given pose — behind the hull along its heading, and above it. */
export function fpvEye(pose: FpvPose): FpvEye {
  const { followDistance, height } = gameConfig.drone.fpv;
  return {
    x: pose.x - Math.cos(pose.heading) * followDistance,
    y: pose.y - Math.sin(pose.heading) * followDistance,
    z: pose.ground + height,
  };
}

/**
 * The world → canvas-pixel matrix for one frame.
 *
 * The perspective half is written out rather than taken from a library because it
 * is unusual in two respects. `w = camZ` (not `−camZ`), and the `z` row is `camZ −
 * 2·near`: that second one is doing real work — GL clips a vertex unless
 * `−w ≤ z ≤ w`, and with those two rows the lower bound reduces to `camZ ≥ near`.
 * So the near plane is enforced by the same rasteriser that interpolates across
 * it, and a grid line running from under the hull out past the horizon is cut at
 * the right place instead of exploding through the division. Depth itself is never
 * read: there is no depth buffer here, and draw order does the sorting.
 *
 * The second is that the `x`/`y` rows carry the **viewport** as well as the
 * perspective, so the result is pixels and not NDC. Folding it in costs two extra
 * terms and keeps the promise in the header: the shader hands `xy` and `w` straight
 * to Pixi's `mat3` and the CPU divides them, and neither writes the mapping out.
 *
 * It is also what makes the whole thing survive being rendered somewhere other than
 * the canvas. Under a filter, Pixi draws the container into a pooled offscreen
 * texture — rounded **up to a power of two**, so 980×800 becomes 1024×1024 — and
 * compensates in the matrices it binds. Anything writing NDC itself ignores that
 * compensation and spreads across the whole pooled texture; the ground did exactly
 * that, and drifted away from the machines standing on it.
 */
export function viewProjection(pose: FpvPose, screenW: number, screenH: number): FpvProjection {
  const { pitchDeg } = gameConfig.drone.fpv;
  return projectionFrom(fpvEye(pose), pose.heading, (pitchDeg * Math.PI) / 180, screenW, screenH);
}

/** The matrix for an explicit eye and orientation — what the rig below needs, and what `viewProjection` is. */
function projectionFrom(
  eye: FpvEye,
  heading: number,
  pitch: number,
  screenW: number,
  screenH: number,
): FpvProjection {
  const { fovDeg, near } = gameConfig.drone.fpv;

  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // Screen right, screen up, and the view direction. See the header for why R is
  // the heading turned clockwise on the map.
  const r = [-sh, ch, 0] as const;
  const u = [ch * sp, sh * sp, cp] as const;
  const d = [ch * cp, sh * cp, -sp] as const;

  const dot = (v: readonly number[]): number => v[0] * eye.x + v[1] * eye.y + v[2] * eye.z;

  const aspect = screenH > 0 ? screenW / screenH : 1;
  const fy = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const fx = fy / aspect;

  // Rows of viewport · P · V, in the order (x, y, z, w). Written as rows because
  // that is how the derivation reads; transposed on the way into the buffer.
  //
  // Each of `x` and `y` is the perspective row scaled by a half-extent, plus the
  // `w` row scaled by the same — which is the centring `+ screenW/2` of an ordinary
  // viewport transform, expressed homogeneously so nothing has to divide early. `y`
  // takes the perspective term negative because screen `y` runs down and the
  // camera's `U` runs up.
  const halfW = screenW / 2;
  const halfH = screenH / 2;
  const wRow = [d[0], d[1], d[2], -dot(d)];
  /** One viewport row: the perspective term, plus the centring offset carried on `w`. */
  const viewportRow = (axis: readonly number[], scale: number, half: number): number[] => [
    scale * axis[0] + half * wRow[0],
    scale * axis[1] + half * wRow[1],
    scale * axis[2] + half * wRow[2],
    -scale * dot(axis) + half * wRow[3],
  ];
  const rows = [
    viewportRow(r, fx * halfW, halfW),
    viewportRow(u, -fy * halfH, halfH),
    [d[0], d[1], d[2], -dot(d) - 2 * near],
    wRow,
  ];

  const matrix = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) matrix[col * 4 + row] = rows[row][col];
  }

  return { matrix, eye, near };
}

/**
 * A world point through the same matrix the shader uses, landed on the canvas —
 * or null when it is at or behind the near plane, which is where the GPU would
 * have clipped it.
 *
 * Callers drawing line segments must drop a segment when **either** end comes back
 * null rather than skipping just that end: this does no clipping, and half a
 * projected segment is a line to somewhere the other end never was.
 */
export function project(view: FpvProjection, x: number, y: number, z: number): ScreenPoint | null {
  const m = view.matrix;
  const px = m[0] * x + m[4] * y + m[8] * z + m[12];
  const py = m[1] * x + m[5] * y + m[9] * z + m[13];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= view.near) return null;
  // The viewport is already in the matrix, so this is the whole of the CPU side:
  // one divide, and no second copy of where the middle of the screen is.
  return { x: px / w, y: py / w, depth: w };
}

/**
 * How far (px) the camera drifts back at full speed, and the time constant it
 * settles over.
 *
 * **The lag is longitudinal, not positional.** The obvious way to write inertia is
 * to smooth the eye's world position toward where it belongs; pulling *back along
 * the hull's own axis* with speed gives the same reading — the camera falls behind
 * as you open the throttle and comes back in as you stop — and cannot lose the
 * hull, because it never leaves that axis.
 *
 * It was written this way because a possessed hull's heading used to *snap* to the
 * stick, and a 180° flip would have swung a smoothed anchor a quarter of a turn
 * away and taken the machine clean off the monitor for as long as the smoothing
 * lasted. That is no longer true — the pilot now turns the hull at a bounded rate
 * (`drivePossessed`), so positional inertia has become possible. It is still not
 * *here*: swinging with the hull is a separate call about how the view should
 * feel, not a consequence of the control law.
 */
const DOLLY = { atFullSpeed: 26, tau: 0.5 };

/**
 * Recoil: how far back and how far the muzzle climbs, and how fast it settles.
 *
 * A kamikaze never gets one, and it falls out rather than being special-cased —
 * its weapon has no cooldown, so there is no rising edge to detect. Its shot is
 * its death, and there is nothing left to shove.
 */
const RECOIL = { push: 22, climbDeg: 5.5, tau: 0.16 };

/** Being hit: how far the tube is thrown about, and how fast it stops ringing. */
const SHAKE = { amplitude: 7, tau: 0.28, hz: 17 };

/** What the rig is told each frame beyond the pose — all of it read off the world by `FpvView`. */
export interface FpvRigInput {
  pose: FpvPose;
  /** Seconds since the last frame, already clamped by the caller. */
  dt: number;
  /** How hard the hull is driving, 0..1. */
  drive: number;
  /** A round left the barrel this frame (the rising edge of `weapon.cooldownLeft`). */
  shot: boolean;
  /** Fraction of max hp lost this frame, 0 when nothing landed. */
  hit: number;
  screenW: number;
  screenH: number;
}

/**
 * The camera's own physics: throttle lag, recoil and the ring after a hit.
 *
 * Stateful, and deliberately the *only* stateful thing in this file — everything
 * above is a pure function of a pose. It is also the only part of the wireframe
 * view that has to be told when the hull changes, hence `reset`.
 *
 * **No engine changes were needed for any of it.** The bus has no damage event and
 * `projectileFired` does not carry the shooter's id (`engine/game/events.ts`), so
 * an event-driven version would have meant new events on a deterministic pipeline
 * for the sake of a camera. The rising edge of `weapon.cooldownLeft` and a fall in
 * `hp` are both readable from the world in the render pass, and neither can desync
 * anything, because neither is written back.
 */
export class FpvCameraRig {
  private dolly = 0;
  private recoil = 0;
  private shake = 0;
  /** Rig-local clock, for the shake waveform. Wall time, and only ever cosmetic. */
  private clock = 0;
  private fresh = true;

  /** Called when the pilot takes a different hull — none of this state belongs to the new one. */
  reset(): void {
    this.dolly = 0;
    this.recoil = 0;
    this.shake = 0;
    this.fresh = true;
  }

  frame(input: FpvRigInput): FpvProjection {
    const { pose, dt, drive, screenW, screenH } = input;
    const { pitchDeg, followDistance, height } = gameConfig.drone.fpv;
    this.clock += dt;

    if (input.shot) this.recoil = 1;
    // Additive rather than latched: a burst that lands in one frame should ring
    // the tube harder than a single round, and a big hit harder than a graze.
    if (input.hit > 0) this.shake = Math.min(1, this.shake + input.hit * 4);

    // Frame-rate independent settling: `1 − exp(−dt/τ)` is the same curve at 30 fps
    // and at 144, where a plain `x *= 0.9` per frame is a different curve on every
    // machine. `fresh` snaps rather than easing in from zero, so taking a hull at
    // speed does not open with the camera sliding into place.
    const ease = (tau: number) => (this.fresh ? 1 : 1 - Math.exp(-dt / tau));
    this.dolly += (drive * DOLLY.atFullSpeed - this.dolly) * ease(DOLLY.tau);
    this.recoil -= this.recoil * ease(RECOIL.tau);
    this.shake -= this.shake * ease(SHAKE.tau);
    this.fresh = false;

    const back = followDistance + this.dolly + this.recoil * RECOIL.push;
    const ch = Math.cos(pose.heading);
    const sh = Math.sin(pose.heading);
    // A decaying wobble rather than noise: this file may not touch the engine's
    // seeded `Rng` (it would desync lockstep), and a sine pair reads as a tube
    // ringing where white noise reads as a dropped frame.
    const wobble = this.shake * SHAKE.amplitude;
    const w = this.clock * SHAKE.hz;
    const eye: FpvEye = {
      x: pose.x - ch * back - sh * Math.sin(w * 1.7) * wobble,
      y: pose.y - sh * back + ch * Math.sin(w * 1.7) * wobble,
      z: pose.ground + height + Math.sin(w) * wobble * 0.7,
    };
    // The muzzle climbs on recoil: less downward tilt, so the horizon drops.
    const pitch = ((pitchDeg - this.recoil * RECOIL.climbDeg) * Math.PI) / 180;
    return projectionFrom(eye, pose.heading, pitch, screenW, screenH);
  }
}
