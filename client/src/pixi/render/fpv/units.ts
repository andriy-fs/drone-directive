import type { Graphics } from 'pixi.js';
import { palette } from '../../../config/palette';
import type { BaseEntity, RobotEntity } from '../../../engine/ecs/archetypes';
import { NodeKind, flatten, type Flat, type Model, type ScreenBounds, type UnitPose } from '../../../models';
import type { FpvProjection } from './camera';

/**
 * How a model gets onto the monitor: `flatten` rotates it onto the machine's
 * heading and projects it, and this strokes the result into a `Graphics`.
 *
 * **Rebuilt every frame, and that is affordable here for the reason the ground is
 * not.** The ground is the whole map, so it is a static buffer with the projection
 * in a shader; the machines are whatever falls inside a 66° sector of it, which is a
 * handful. If a measurement ever says otherwise the answer is the same `line-list`
 * geometry the terrain uses with the transform moved into the vertex stage — the
 * models are already flat segment lists, so nothing above this file would change.
 *
 * ## Heat
 *
 * The two numbers the simulation already holds, and no new ones:
 *
 * - `weapon.cooldownLeft / weapon.cooldown` is **"just fired"** — it is at its
 *   maximum the instant a round leaves and falls to zero as the gun comes back
 *   ready, which is exactly the curve a barrel cools on. Read straight, no decay
 *   state of its own, nothing to keep in sync.
 * - `hypot(movement.velX, movement.velY) / movement.speed` is **"driving hard"** —
 *   actual ground speed last tick against what the chassis can do. A hull holding
 *   station reads zero, one at a crawl around an obstacle reads low, and one at full
 *   pelt reads one.
 *
 * That makes heat the most *informative* thing on this screen and the reason it is
 * worth the segments: at range a contour tells you what a machine is, and its nodes
 * tell you what it is doing. An enemy whose barrel is glowing has just shot at
 * someone — which is knowledge the top view has never had a way to show.
 *
 * Heat stays here rather than in `models/` for the same reason the `Graphics` does:
 * it reads ECS entities, and that layer knows nothing about the simulation.
 */

/** How hot the two families of node are running, 0..1. */
export interface Heat {
  /** Drive: wheels, track links, walker joints, and the powerplant behind them. */
  drive: number;
  /** Whatever the weapon fires out of. */
  barrel: number;
}

/** A machine that is neither moving nor shooting — bases with no battery, drones, wrecks. */
export const COLD: Heat = { drive: 0, barrel: 0 };

/**
 * The powerplant's floor.
 *
 * An engine at idle is still warm, and drawing it dead cold would make a parked
 * machine indistinguishable from scenery. Small enough that a moving hull is still
 * obviously the one under load.
 */
const IDLE_ENGINE = 0.22;

/** Below this a node is simply structure — a second stroke at 2% alpha costs a draw call and shows nothing. */
const HEAT_FLOOR = 0.06;

/**
 * Line widths: structure, and the heat drawn over it.
 *
 * The heat pass is **fatter as well as warmer**, and it has to be. `self` is a
 * near-white, so brightness alone says nothing on the hull the player watches most;
 * anything redder would collide with `foe`. A thicker warm line reads as something
 * glowing on every one of the three roles.
 */
const WIDTH = { structure: 1, heat: 2 };

/** Colour and heat for one machine, decided by the caller from owner and range. */
export interface UnitStyle {
  color: number;
  alpha: number;
  heat: Heat;
}

export function robotHeat(robot: RobotEntity): Heat {
  const { weapon, movement } = robot;
  const speed = movement.speed > 0 ? Math.hypot(movement.velX, movement.velY) / movement.speed : 0;
  return {
    drive: Math.min(1, speed),
    // A weapon with no cooldown never fires (a radar, a jammer, an empty
    // hardpoint), and dividing by it would light every one of them permanently.
    barrel: weapon.cooldown > 0 ? Math.min(1, weapon.cooldownLeft / weapon.cooldown) : 0,
  };
}

/**
 * A base's battery, on the same rule as a robot's gun. Bases do not move, so the
 * drive channel is left at zero rather than given a floor — a building has no drive
 * to be warm.
 */
export function baseHeat(base: BaseEntity): Heat {
  const { weapon } = base;
  return { drive: 0, barrel: weapon.cooldown > 0 ? Math.min(1, weapon.cooldownLeft / weapon.cooldown) : 0 };
}

/** What a node kind is running at, given the machine's two channels. */
function heatOf(node: NodeKind, heat: Heat): number {
  switch (node) {
    case NodeKind.Wheel:
    case NodeKind.Joint:
      return heat.drive;
    case NodeKind.Engine:
      // The floor only applies to a machine that has a drive at all; a base's
      // launcher pad carries no engine node, so nothing here glows for free.
      return Math.max(heat.drive, IDLE_ENGINE);
    case NodeKind.Barrel:
      return heat.barrel;
  }
}

/**
 * Projected segments, reused across frames.
 *
 * The array grows to the largest model ever drawn and is then never reallocated:
 * every machine in the frustum is projected into it once and read three times (the
 * structure pass and the two heat passes), rather than being run through the matrix
 * once per pass. `flatten` is written to fill a buffer for exactly this reason.
 */
const projected: Flat[] = [];

/**
 * Draw one machine: its structure, then its hot nodes over the top.
 *
 * Up to three strokes, because a `Graphics` stroke carries one colour — and a marked
 * segment is drawn *twice on purpose*. Structure first means a cold wheel is still a
 * wheel; the heat pass adds emission to it rather than replacing it, so a node never
 * disappears when it cools.
 */
export function drawUnit(
  g: Graphics,
  view: FpvProjection,
  model: Model,
  pose: UnitPose,
  style: UnitStyle,
): void {
  const count = flatten(projected, model, pose, view);

  let any = false;
  for (let i = 0; i < count; i++) {
    if (projected[i].ok) {
      any = true;
      break;
    }
  }
  if (!any) return;

  stroke(g, count, null, style.color, style.alpha, WIDTH.structure);

  // One pass per rate rather than one per channel: a `Graphics` stroke carries a
  // single alpha, and an idling engine glows while the wheels under it do not.
  // Three passes at most, and each is skipped whole when its rate is at the floor.
  for (const node of HEAT_PASSES) {
    const rate = heatOf(node, style.heat);
    if (rate <= HEAT_FLOOR) continue;
    stroke(g, count, node, palette.fpv.heat, style.alpha * rate, WIDTH.heat);
  }
}

/**
 * The order the heat passes go down in, and why it is not one pass per `NodeKind`:
 * wheels and joints always run at the same rate (both are the drive touching the
 * ground), so they share a stroke. The engine has its own floor and the barrel its
 * own channel, so those two cannot join it.
 */
const HEAT_PASSES = [NodeKind.Wheel, NodeKind.Engine, NodeKind.Barrel] as const;

/** Whether a segment belongs to the pass `node` is drawing. */
function inPass(segment: Flat, node: NodeKind): boolean {
  if (node === NodeKind.Wheel) return segment.node === NodeKind.Wheel || segment.node === NodeKind.Joint;
  return segment.node === node;
}

/**
 * Corner brackets around the machine the trigger would take.
 *
 * Brackets rather than a box: the machine already has an outline, and a second one
 * around it reads as part of the machine rather than as something said *about* it.
 * They are given a floor size so a target at the far end of a launcher's reach is
 * still a mark and not a dot.
 */
export function drawTargetMark(g: Graphics, bounds: ScreenBounds, alpha: number): void {
  const PAD = 6;
  const MIN_HALF = 9;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const hx = Math.max((bounds.maxX - bounds.minX) / 2 + PAD, MIN_HALF);
  const hy = Math.max((bounds.maxY - bounds.minY) / 2 + PAD, MIN_HALF);
  // A quarter of the shorter side, so the brackets stay brackets on a base as well
  // as on a robot instead of closing into a rectangle.
  const arm = Math.min(hx, hy) / 2;

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = cx + sx * hx;
      const y = cy + sy * hy;
      g.moveTo(x - sx * arm, y).lineTo(x, y).lineTo(x, y - sy * arm);
    }
  }
  g.stroke({ width: 1, color: palette.fpv.lock, alpha });
}

/** One stroke over the segments of a pass (or the whole model when `node` is null), read out of `projected`. */
function stroke(
  g: Graphics,
  count: number,
  node: NodeKind | null,
  color: number,
  alpha: number,
  width: number,
): void {
  let drew = false;
  for (let i = 0; i < count; i++) {
    const p = projected[i];
    if (!p.ok) continue;
    if (node !== null && !inPass(p, node)) continue;
    g.moveTo(p.ax, p.ay).lineTo(p.bx, p.by);
    drew = true;
  }
  // A `stroke` on an empty path would carry the *previous* machine's geometry into
  // this colour — every pass has to end its own path or none may.
  if (drew) g.stroke({ width, color, alpha });
}
