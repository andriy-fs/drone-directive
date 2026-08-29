/**
 * The one projection these models are ever seen through, and the only maths in
 * this layer that knows what a camera is.
 *
 * **There is exactly one of it, and it lives here.** The hull view projects its
 * terrain on the GPU and its machines on the CPU, which is two code paths — but
 * they are two *consumers* of the same sixteen numbers, never two transcriptions of
 * the same formula. A shader-side copy would be right for as long as nobody edited
 * either one, and the failure it eventually produces (hills and machines half a
 * frame apart) is one nobody would think to look for in a shader. A preview panel
 * in the interface is now a third consumer, and it gets the same treatment: a
 * different eye, the same matrix builder.
 *
 * Pure: no Pixi, no store, no world, and — unlike the rig that used to own this —
 * no `gameConfig`. Field of view and near plane arrive as arguments, which is what
 * lets a menu frame a robot at 30° while the monitor keeps its 66°.
 *
 * ## The space
 *
 * The simulation is 2D and its `y` runs **down** the top-down map (south). This
 * adds a third axis, `z`, running **up** out of the ground, and keeps `x`/`y`
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

/** The camera's own position in the 3D world, in world px. */
export interface Eye {
  x: number;
  y: number;
  z: number;
}

/**
 * A built projection: the matrix, plus the eye it was built from.
 *
 * The eye rides along because a distance fade needs it and deriving it back out of
 * the matrix would be the same duplication this module exists to prevent.
 */
export interface Projection {
  /**
   * World → **canvas pixels**, homogeneous and **column-major** (the order a GLSL
   * `mat4` uniform expects). `xy` come out premultiplied by `w`; divide by `w` and
   * you have the point in CSS pixels from the canvas's top-left.
   *
   * Pixels rather than clip space, deliberately. Every consumer needs the pixel
   * position — the CPU ones to stroke a `Graphics` or to write an SVG `<line>`, the
   * GPU one to hand Pixi's own `mat3` a point in the container's coordinate space —
   * so if the viewport step were left out of here, each of them would write it out
   * again, and this module exists to stop exactly that.
   */
  matrix: Float32Array;
  eye: Eye;
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

/** Everything the matrix is built from. */
export interface CameraSpec {
  eye: Eye;
  /** Which way the camera looks on the map, in radians. */
  heading: number;
  /** How far it is tilted down from level, in radians. */
  pitch: number;
  /** Vertical field of view, in degrees. */
  fovDeg: number;
  /** Near plane, in world px. Anything at or behind it is clipped. */
  near: number;
  screenW: number;
  screenH: number;
}

/**
 * The matrix for an explicit eye and orientation.
 *
 * The perspective half is written out rather than taken from a library because it
 * is unusual in two respects. `w = camZ` (not `−camZ`), and the `z` row is `camZ −
 * 2·near`: that second one is doing real work — GL clips a vertex unless
 * `−w ≤ z ≤ w`, and with those two rows the lower bound reduces to `camZ ≥ near`.
 * So the near plane is enforced by the same rasteriser that interpolates across
 * it, and a grid line running from under the hull out past the horizon is cut at
 * the right place instead of exploding through the division. Depth itself is never
 * read: there is no depth buffer in this view, and draw order does the sorting.
 *
 * The viewport lives **inside** the matrix rather than in the caller. That is what
 * lets the shader hand `xy` and `w` straight to Pixi's `mat3` while the CPU
 * divides them, with neither writing the mapping out.
 *
 * It is also what makes the whole thing survive being rendered somewhere other than
 * the canvas. Under a filter, Pixi draws the container into a pooled offscreen
 * texture — rounded **up to a power of two**, so 980×800 becomes 1024×1024 — and
 * compensates in the matrices it binds. Anything writing NDC itself ignores that
 * compensation and spreads across the whole pooled texture; the ground did exactly
 * that, and drifted away from the machines standing on it.
 */
export function perspective(spec: CameraSpec): Projection {
  const { eye, heading, pitch, fovDeg, near, screenW, screenH } = spec;

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
  const fy = focalLength(fovDeg);
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

/** Half the screen's height over the tangent of half the field of view — the term every row is scaled by. */
export function focalLength(fovDeg: number): number {
  return 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
}

/**
 * Where the ground plane's vanishing line lands, in CSS pixels from the top.
 *
 * **A horizontal line, always.** Screen right is `[-sin h, cos h, 0]` — its `z`
 * component is a hard zero, because this camera does not roll — so every horizontal
 * direction projects to the same screen `y`, and the horizon cannot tilt. It
 * therefore reduces to one number rather than a line equation: a horizontal
 * direction has `u · dir = sin p` and `d · dir = cos p`, so the `y` row over the `w`
 * row collapses to this, independent of heading and of where the eye is.
 *
 * Here rather than in the caller because it is the same projection said a different
 * way, and this module is where the projection is allowed to be written down.
 */
export function horizonOf(pitch: number, fovDeg: number, screenH: number): number {
  return (screenH / 2) * (1 - (focalLength(fovDeg) * Math.sin(pitch)) / Math.cos(pitch));
}

/**
 * A world point through the same matrix the shader uses, landed on the canvas —
 * or null when it is at or behind the near plane, which is where the GPU would
 * have clipped it.
 *
 * Callers drawing line segments must drop a segment when **either** end comes back
 * null rather than skipping just that end: this does no clipping, and half a
 * projected segment is a line to somewhere the other end never was. `flatten` is
 * that rule, written once.
 */
export function project(view: Projection, x: number, y: number, z: number): ScreenPoint | null {
  const m = view.matrix;
  const px = m[0] * x + m[4] * y + m[8] * z + m[12];
  const py = m[1] * x + m[5] * y + m[9] * z + m[13];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= view.near) return null;
  // The viewport is already in the matrix, so this is the whole of the CPU side:
  // one divide, and no second copy of where the middle of the screen is.
  return { x: px / w, y: py / w, depth: w };
}
