/**
 * The machines, as geometry — the one place a unit's shape is written down.
 *
 * Import from here rather than from the files behind it: which file a model lives
 * in is this layer's business, and the split exists so that editing one gun is a
 * diff in one gun's file rather than in a four-hundred-line module holding
 * twenty-three others.
 *
 * See `README.md` for the layer's rule (what it may import) and the local frame.
 */

export { NodeKind, type Model, type Segment, type Vec3 } from './segment';
export { box, detail, frustum, plate, prism, ring, seg, shift, tube, wheel, type Rect } from './primitives';
export { at, mirrorY, type Placement } from './transform';
export {
  modelBounds,
  screenBoundsOf,
  type ModelBounds,
  type ScreenBounds,
  type Span,
} from './bounds';
export {
  focalLength,
  horizonOf,
  perspective,
  project,
  type CameraSpec,
  type Eye,
  type Projection,
  type ScreenPoint,
} from './project';
export { flatten, type Flat, type FlattenOptions, type UnitPose } from './flatten';
export { turntable, type TurntableSpec } from './turntable';
export { CHASSIS, type Chassis } from './chassis';
export { WEAPONS } from './weapons';
export { ROBOT_MODELS, robotParts, type RobotParts } from './robots';
export { BASE_BODY, BASE_LAUNCHER } from './structures';
export { DRONE_MODEL, MUNITION_MODEL, PROJECTILE_MODEL } from './ordnance';
