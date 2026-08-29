import { gameConfig } from '../../../config/gameConfig';
import { horizonOf, perspective, type Eye, type Projection } from '../../../models';

/**
 * Where the wireframe view is looking from: the eye, and the physics that shoves
 * it about.
 *
 * **The projection itself is not here.** It lives in `client/src/models/project.ts`,
 * with the machines it draws, because a preview panel in the interface needs the
 * same sixteen numbers built round a different eye. What is left in this file is
 * the half that is specific to riding a hull — where the camera sits behind it,
 * how far it lags, how hard a shot shoves it — all of which reads `gameConfig`
 * and none of which any other view wants.
 *
 * The invariant that mattered survives the move intact: the terrain is projected
 * on the GPU and the units on the CPU, and they are two *consumers* of one matrix,
 * never two transcriptions of one formula. There is still exactly one place that
 * matrix is written down; it is one directory further out.
 *
 * Pure above `FpvCameraRig`: `fpvEye` and `viewProjection` take a pose and a
 * viewport and return numbers, which is what lets `camera.test.ts` check the
 * awkward half — that "right" on screen is the driver's right, and that what is
 * behind the hull is behind the near plane.
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
export type FpvEye = Eye;

/**
 * The shared projection plus the one thing only a view of the *ground* needs.
 *
 * `horizonY` rides along rather than being recomputed by the caller for the reason
 * the eye does: `pitch` is known at the only place the matrix is built and nowhere
 * else, and recovering it from the matrix would be the duplication `project.ts`
 * exists to prevent. It moves with the recoil, since that is what recoil tilts.
 */
export interface FpvProjection extends Projection {
  /**
   * Where the ground plane's vanishing line lands, in CSS pixels from the top.
   * A horizontal line, always — this camera does not roll. See `horizonOf`.
   */
  horizonY: number;
}

/**
 * Back into (-pi, pi]. The rig accumulates a heading of its own, so it needs the
 * same wrap `drivePossessed` does — duplicated rather than shared because the
 * renderer may not reach into the engine for three lines of trigonometry.
 */
function wrapAngle(a: number): number {
  const turn = Math.PI * 2;
  const wrapped = a % turn;
  if (wrapped > Math.PI) return wrapped - turn;
  if (wrapped <= -Math.PI) return wrapped + turn;
  return wrapped;
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
 * The world → canvas-pixel matrix for one frame, at the pose the pilot's hull is in.
 *
 * The matrix itself is `perspective()`'s; what this adds is the two numbers that
 * make it *this* view — the eye placed behind the hull, and the fixed downward tilt
 * the monitor is bolted at.
 */
export function viewProjection(pose: FpvPose, screenW: number, screenH: number): FpvProjection {
  const { pitchDeg } = gameConfig.drone.fpv;
  return projectionFrom(fpvEye(pose), pose.heading, (pitchDeg * Math.PI) / 180, screenW, screenH);
}

/**
 * The matrix for an explicit eye and orientation — what the rig needs, and what
 * `viewProjection` is.
 *
 * Two lines, and both of them are this view's own numbers: the shared builder is
 * told the field of view and near plane the monitor uses, and the horizon is the
 * same projection said a different way.
 */
function projectionFrom(
  eye: FpvEye,
  heading: number,
  pitch: number,
  screenW: number,
  screenH: number,
): FpvProjection {
  const { fovDeg, near } = gameConfig.drone.fpv;
  return {
    ...perspective({ eye, heading, pitch, fovDeg, near, screenW, screenH }),
    horizonY: horizonOf(pitch, fovDeg, screenH),
  };
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
 * lasted. The pilot now turns the hull at a bounded rate (`drivePossessed`), which
 * is what let `SWING` below add the lateral half.
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

/**
 * How long the view takes to come round after the hull has turned.
 *
 * **This is the lateral half of the lag, and it is bought by placing the camera on
 * a heading of its own.** The eye trails behind along `anchor` and the matrix looks
 * down `anchor` — so the hull sits dead centre either way and the camera cannot
 * lose it, which is the objection that kept this out. What lags is the *world*:
 * mid-turn the machine is drawn at its own heading while the picture is still
 * built on the old one, so the pilot watches their own hull nose into the corner
 * and the ground swing after it.
 *
 * Short. At the shipped 160°/s a quarter-second constant leaves the view about 20°
 * behind at full rate, which reads as weight; much more and aiming stops feeling
 * connected to the stick, because the thing you are pointing has left the middle of
 * the screen for as long as you hold the turn.
 */
const SWING = { tau: 0.18 };

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
  /** The heading the *view* is built on, chasing the hull's — see `SWING`. */
  private anchor = 0;
  /** Rig-local clock, for the shake waveform. Wall time, and only ever cosmetic. */
  private clock = 0;
  private fresh = true;

  /** Called when the pilot takes a different hull — none of this state belongs to the new one. */
  reset(): void {
    this.dolly = 0;
    this.recoil = 0;
    this.shake = 0;
    this.fresh = true; // `anchor` is snapped to the new hull on the next frame, not zeroed
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
    // Eased over the *shortest* arc: the two headings sit either side of ±pi
    // whenever a turn crosses due west, and easing the raw difference there would
    // send the view the long way round a machine that turned a single degree.
    // `fresh` makes the first frame a snap, so taking a hull that faces west does
    // not open with a half-second sweep from due east.
    this.anchor = wrapAngle(this.anchor + wrapAngle(pose.heading - this.anchor) * ease(SWING.tau));
    this.fresh = false;

    const back = followDistance + this.dolly + this.recoil * RECOIL.push;
    const ch = Math.cos(this.anchor);
    const sh = Math.sin(this.anchor);
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
    // `anchor`, not the hull's heading, and for both halves: the eye is placed on
    // this axis and the matrix looks down it, so the hull stays centred while the
    // world is the thing that lags.
    return projectionFrom(eye, this.anchor, pitch, screenW, screenH);
  }
}
