import type { Model } from './segment';
import { modelBounds } from './bounds';
import { perspective, type Projection } from './project';

/**
 * A camera that orbits one model and frames it, for showing a machine outside a
 * match — a title screen, the preview beside a build configurator.
 *
 * **The model does not move; the camera goes round it.** Both readings look the
 * same on screen, and this one is the one that keeps `flatten` honest: the machine
 * is drawn at the pose it would have in the world (origin, heading zero) and the
 * only thing that changes is where it is being watched from. Nothing here has to
 * agree with anything the simulation believes.
 *
 * ## Framing
 *
 * The distance is solved rather than tuned. A model is bounded by a sphere, and the
 * sphere is fitted into whichever of the two half-angles is tighter — the vertical
 * field of view, or the horizontal one the aspect ratio gives it. So a tall narrow
 * panel and a wide one both show the whole machine, and a walker does not overflow a
 * frame that a buggy fits inside.
 */
export interface TurntableSpec {
  /**
   * Where the camera stands, as a bearing round the machine in radians: **0 is
   * dead ahead of it**, and increasing angles walk round toward the machine's
   * right. Expressed this way rather than as the camera's own heading because a
   * caller spinning a preview is thinking about the machine, not about the lens.
   */
  spin?: number;
  /** How far above the machine the camera looks down from, in radians. */
  pitch?: number;
  /** The panel's size in CSS pixels. */
  width: number;
  height: number;
  /** Vertical field of view. Longer than the hull view's 66°: a preview is a portrait, not a windscreen. */
  fovDeg?: number;
  /** Slack round the bounding sphere. 1 fits it exactly, which is tighter than it sounds. */
  padding?: number;
}

export function turntable(model: Model, spec: TurntableSpec): Projection {
  const { width, height } = spec;
  const spin = spec.spin ?? 0;
  const pitch = spec.pitch ?? 0.42;
  const fovDeg = spec.fovDeg ?? 30;
  const padding = spec.padding ?? 1.15;

  const b = modelBounds(model);
  const centre = {
    x: (b.x.min + b.x.max) / 2,
    y: (b.y.min + b.y.max) / 2,
    z: (b.z.min + b.z.max) / 2,
  };
  const radius = Math.max(
    Math.hypot(b.x.max - b.x.min, b.y.max - b.y.min, b.z.max - b.z.min) / 2,
    // An empty model (a bare hardpoint) has no extent at all, and dividing the
    // frame by nothing would put the camera on top of the origin.
    1,
  );

  const halfFovY = ((fovDeg * Math.PI) / 180) / 2;
  const aspect = height > 0 ? width / height : 1;
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect);
  const distance = (radius / Math.sin(Math.min(halfFovY, halfFovX))) * padding;

  // The camera looks *back* along the bearing it stands on, so a spin of zero has
  // it in front of the machine looking at its face.
  const heading = spin + Math.PI;
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  return perspective({
    eye: {
      x: centre.x - ch * cp * distance,
      y: centre.y - sh * cp * distance,
      z: centre.z + sp * distance,
    },
    heading,
    pitch,
    fovDeg,
    // Half the clearance in front of the model: close enough never to clip it, far
    // enough that a point behind the camera is still rejected.
    near: Math.max(0.5, (distance - radius) / 2),
    screenW: width,
    screenH: height,
  });
}
