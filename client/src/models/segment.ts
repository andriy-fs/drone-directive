/**
 * What a machine is made of: line segments in the machine's own coordinates.
 *
 * **Data in code, and deliberately no art pipeline.** A wireframe is a list of
 * vertices; there is nothing here for `encode-sprites.mjs` to encode, no master to
 * keep, and no brief to write. The cost is paid elsewhere and is worth stating
 * plainly: **a new unit is two jobs** — a sprite and a model — and a forgotten
 * model makes that unit *invisible* to anyone in a hull. The insurance is that
 * `CHASSIS` and `WEAPONS` are exhaustive `Record`s over `types/src/enums.ts`, so a
 * new key there fails the build instead of the picture.
 *
 * ## The local frame
 *
 * `x` runs **forward** along the machine's heading, `y` to its **right**, `z` up
 * from the ground it stands on. That is not the world frame renamed: world `y` runs
 * south, and a machine's right is south only when it happens to face east.
 * `flatten.ts` owns the rotation.
 */

/** A direction in the model's own frame. Not normalised by the type — `flatten` only takes its sign. */
export type Vec3 = readonly [number, number, number];

/** The four kinds of part that run hot. Everything else is structure. */
export const NodeKind = {
  /** Anything turning against the ground — a track link, a road wheel, a tire. */
  Wheel: 'wheel',
  /** An articulated joint: a walker's hip and knee. */
  Joint: 'joint',
  /** The powerplant, wherever the chassis puts it. */
  Engine: 'engine',
  /** Whatever the weapon sends its round, beam or swarm out of. */
  Barrel: 'barrel',
} as const;
export type NodeKind = (typeof NodeKind)[keyof typeof NodeKind];

/** One line of a model, both ends in local coordinates. */
export interface Segment {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Marks it as a part that heats — drawn a second time in the heat colour. */
  node?: NodeKind;
  /**
   * The faces this edge borders, as outward normals in the local frame.
   *
   * **The rule is "any", not "all": an edge is hidden only when every face it
   * borders is turned away.** That is exactly right for a convex solid and it is
   * why the field is a list rather than one normal — the top edge of a box belongs
   * to the lid *and* to a side, and it stays drawn while either of them is facing
   * you. A single normal would take the bottom-front edge of every hull off the
   * screen and leave the machines floating.
   *
   * Absent means "never cull", which is the right answer for a rim, a spoke, an
   * aerial and anything else that is a line rather than the border of a surface.
   * Nothing is culled at all unless the caller asks (`flatten`'s `cull`), so
   * tagging a primitive is inert until a renderer opts in.
   */
  faces?: readonly Vec3[];
  /**
   * Detail tier: 0 (or absent) is always drawn, 1 only close up.
   *
   * Without this, a panel line costs the same at eight hundred pixels as it does
   * at eight, so the models stay bare to stay affordable. `flatten` takes the tier
   * to draw down to; the hull view picks it by range, a preview always takes the
   * lot. See `detail()` in `primitives.ts`.
   */
  lod?: number;
}

/** A machine's outline: segments in local coordinates, drawn at its position and heading. */
export type Model = readonly Segment[];
