import { Container, Graphics, Mesh, type Geometry, type Rectangle, type Shader } from 'pixi.js';
import { palette } from '../../../config/palette';
import { worldPixelSize } from '../../../config/gameConfig';
import type { Entity } from '../../../engine/ecs/entity';
import type { EcsWorld } from '../../../engine/ecs/world';
import type { RobotEntity } from '../../../engine/ecs/archetypes';
import { bases, drones, munitions, projectiles, robots } from '../../../engine/ecs/queries';
import { isAlive } from '../../../engine/ecs/guards';
import { isDisabled } from '../../../engine/systems/status';
import { jamPressure } from '../../../engine/systems/vision';
import { manualFireTarget } from '../../../engine/systems/drone';
import { perfFlags } from '../../perf/perfFlags';
import type { FogState, GameContext } from '../../../engine/game/context';
import type { TerrainGrid } from '../../../engine/obstacles';
import { FpvCameraRig, type FpvProjection } from './camera';
import { FeedFilter } from './FeedFilter';
import { FpvFogMask } from './fogMask';
import { createFpvTerrainShader } from './shaders';
import { heightField, terrainGeometry, type HeightField } from './terrain';
import {
  BASE_BODY,
  BASE_LAUNCHER,
  DRONE_MODEL,
  MUNITION_MODEL,
  PROJECTILE_MODEL,
  ROBOT_MODELS,
  type Model,
} from './models';
import { COLD, baseHeat, drawTargetMark, drawUnit, robotHeat, screenBoundsOf, type Heat } from './units';

/**
 * The wireframe hull view: the second renderer in this folder, and the one the
 * player sees while a drone is riding a robot.
 *
 * **The top view is replaced, not tilted.** `GameApp` hides `camera.view` and shows
 * this container; nothing about the world layers is transformed. That is the single
 * decision the cost of this whole feature hangs off, and it buys two things at once.
 * Nothing built for a top-down square grid has to survive being seen at an angle —
 * the fog mask, the health bars, the selection rings, the radius circles and the
 * pointer hit-test are not squashed into ellipses over a sheared grid, they are
 * simply not on screen — and letting go of the view puts them all back exactly as
 * they were, because they were never touched.
 *
 * It also means the two views can disagree about how the world *looks* while
 * agreeing completely about what is in it. Everything here reads the same ECS world
 * and the same `isVisible` gate the top view uses; there is no second source of
 * truth and no second visibility rule.
 *
 * ## What is drawn, in order
 *
 * 1. The tube's black, over the whole canvas — the world layers are hidden, so
 *    without it the canvas clear colour would show through as ordinary sky.
 * 2. The ground, as one static `line-list` mesh with the entire projection in its
 *    vertex shader (`terrain.ts`, `shaders.ts`). One draw call, whatever the map.
 * 3. Machines, rebuilt into a `Graphics` every frame. Affordable for exactly the
 *    reason the ground is not: the ground is the map and the machines are the few
 *    of them that fall inside a 66° sector of it.
 *
 * There is no depth buffer, so the ordering above *is* the sorting: a contour always
 * draws over the terrain, including terrain in front of it. At stage 1 that is a
 * deliberate non-problem — a machine hidden behind a ridge you are looking at is
 * information the simulation already decided you have, and hiding it would need a
 * second occlusion rule that no longer matched `isVisibleToLocalSide`.
 */

/**
 * Where the monitor starts losing the picture and where it has lost it, in world px.
 *
 * Shared by the ground shader and the machines deliberately: a contour that stayed
 * crisp after the ground under it had faded out would float in the dark, and the
 * two falling off together is what makes the far end of the screen read as *range*
 * rather than as a clipping plane.
 */
const FADE = { start: 380, end: 1180 };

/**
 * Time constant (seconds) the pilot's own drive reading settles over.
 *
 * Long enough to bridge two frames landing inside one 30 Hz tick — which would
 * otherwise alternate between full speed and a dead stop — and short enough that
 * letting go of the stick puts the glow out while the hull is still rolling to a
 * halt, which is what it is doing.
 */
const DRIVE_SMOOTHING = 0.12;

/** Time constant (seconds) the dead-signal static comes up and goes down over. */
const DEAD_RAMP = 0.09;

/** Line colour as linear 0..1, which is what the shader wants. */
function rgb(hex: number): number[] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/** Everything one frame of the view needs. Assembled by `GameApp`, which owns all of it. */
export interface FpvFrame {
  /** The hull the local side's drone is riding — the camera hangs off this. */
  robot: RobotEntity;
  world: EcsWorld;
  fog: FogState | null | undefined;
  /**
   * The live match, for the two things the monitor reads that are not entity
   * components: `jamPressure` and, through it, everything the interference does.
   */
  ctx: GameContext | null;
  /** The same fog-of-war gate the top view uses. Handed in rather than rebuilt here. */
  isVisible: (e: Entity) => boolean;
  /** Canvas size in CSS px. */
  width: number;
  height: number;
  /** `GameApp`'s single wall-clock read for the frame — see `pilotDrive`. */
  now: number;
}

export class FpvView {
  readonly container: Container;
  private readonly backdrop = new Graphics();
  private readonly units = new Graphics();
  private terrain: Mesh<Geometry, Shader> | null = null;
  private shader: Shader | null = null;
  /**
   * The two uniforms that move. Held as the live object rather than re-read through
   * `shader.resources` each frame — a uniform group with `isStatic` off is uploaded
   * on every bind, so writing the fields is the whole update.
   */
  private uniforms: { uViewProj: Float32Array; uEye: Float32Array } | null = null;
  private readonly eye = new Float32Array(3);
  private fogMask: FpvFogMask | null = null;
  private heights: HeightField | null = null;
  /** Ground the pilot's own hull has covered since the last frame — see `pilotDrive`. */
  private readonly pilot = { id: '', x: 0, y: 0, at: 0, drive: 0 };
  private readonly rig = new FpvCameraRig();
  private readonly feed: FeedFilter | null = perfFlags.feed ? new FeedFilter() : null;
  /**
   * Last frame's reading of the pilot's hull, for the two edges the rig runs on.
   * `cooldownLeft` *rising* is a round leaving the barrel; `hp` falling is one
   * arriving. Neither exists on the bus — see `FpvCameraRig`.
   */
  private readonly last = { id: '', cooldown: 0, hp: 0 };
  /** How far the dead-signal static has come up, so the cut-off is a collapse rather than a frame drop. */
  private dead = 0;

  constructor() {
    this.container = new Container();
    this.container.label = 'fpv';
    // The world layers underneath are hidden rather than removed, and a stray
    // hit-test reaching them would select or order things the player cannot see.
    this.container.eventMode = 'none';
    this.container.visible = false;
    this.container.addChild(this.backdrop, this.units);
    // Attached once and left on: this container is only ever visible while a drone
    // is riding a hull, so "only during possession" is already true of the whole
    // subtree. `filterArea` is what makes it affordable — see `attachTo`.
    if (this.feed) this.container.filters = [this.feed.filter];
  }

  /**
   * Bound the filter pass to the canvas.
   *
   * Without this Pixi measures the target with `getGlobalBounds`, and the terrain
   * mesh's bounds are the *whole map* in world coordinates — the pass would size
   * its pooled texture to a battlefield rather than to a viewport. `app.screen` is
   * a live `Rectangle` that tracks resizes, so this is set once.
   */
  attachTo(screen: Rectangle): void {
    this.container.filterArea = screen;
  }

  /**
   * Build (or drop) the static half for a match — the relief, the wireframe buffer
   * and the fog mask, all of which are sized off the grid and none of which change
   * again until the next match. Mirrors `GameApp.rebuildObstacles`/`rebuildFog`, and
   * is called from the same place for the same reason: map size is per match.
   */
  setTerrain(terrain: TerrainGrid | null): void {
    this.clearTerrain();
    if (!terrain || terrain.length === 0) return;

    const heights = heightField(terrain);
    const fogMask = new FpvFogMask(heights.tilesX, heights.tilesY);
    const shader = createFpvTerrainShader(
      fogMask.texture,
      [worldPixelSize.width, worldPixelSize.height],
      rgb(palette.fpv.terrain),
      FADE,
    );
    const mesh = new Mesh({ geometry: terrainGeometry(terrain, heights), shader });
    // Every vertex is placed by `uViewProj`, so the container transform Pixi would
    // otherwise fold in means nothing here — and the bounds derived from world-space
    // positions describe the map, not the part of it on screen.
    mesh.cullable = false;

    this.heights = heights;
    this.fogMask = fogMask;
    this.shader = shader;
    this.uniforms = shader.resources.fpvUniforms.uniforms;
    this.terrain = mesh;
    // Under the machines, over the backdrop.
    this.container.addChildAt(mesh, 1);
  }

  /** Draw one frame. Cheap to call while hidden — `GameApp` simply doesn't. */
  render(frame: FpvFrame): void {
    const { robot, width, height } = frame;
    const dt = this.beat(robot, frame.now);
    const ground = this.heights?.at(robot.position.x, robot.position.y) ?? 0;
    const view = this.rig.frame({
      pose: { x: robot.position.x, y: robot.position.y, heading: robot.heading, ground },
      dt,
      drive: this.pilot.drive,
      shot: this.shot,
      hit: this.hit,
      screenW: width,
      screenH: height,
    });

    this.backdrop.clear();
    this.backdrop.rect(0, 0, width, height).fill(palette.fpv.void);

    // Electronics down: the monitor is showing nothing but its own noise. The
    // scene is not drawn *at all* rather than being covered over — there is no
    // signal, so there is nothing to pay for either. The ramp is short enough to
    // read as the feed collapsing and long enough not to read as a dropped frame.
    const target = isDisabled(robot) ? 1 : 0;
    this.dead += (target - this.dead) * (1 - Math.exp(-dt / DEAD_RAMP));
    const blind = this.dead > 0.985;
    if (this.terrain) this.terrain.visible = !blind;
    this.units.visible = !blind;

    this.feed?.update({
      time: frame.now / 1000,
      // Read at the hull, and counted from every jammer whether this side has
      // found it or not: interference says you are being jammed, not where from.
      jam: frame.ctx ? jamPressure(frame.ctx, robot.owner, robot.position) : 0,
      dead: this.dead,
    });

    this.fogMask?.update(frame.fog);
    if (this.uniforms) {
      this.eye[0] = view.eye.x;
      this.eye[1] = view.eye.y;
      this.eye[2] = view.eye.z;
      this.uniforms.uViewProj = view.matrix;
      this.uniforms.uEye = this.eye;
    }

    if (!blind) this.drawUnits(frame, view);
    else this.units.clear();
  }

  /** A shot left the pilot's barrel on this frame. */
  private shot = false;
  /** Fraction of max hp the pilot's hull lost on this frame. */
  private hit = 0;

  /**
   * Per-frame bookkeeping for the pilot's hull: the frame delta, and the two edges
   * the camera rig runs on.
   *
   * Both are *polled*, not subscribed, and that is what keeps the engine untouched:
   * the bus carries no damage event at all, and `projectileFired` does not say who
   * fired it (`engine/game/events.ts`). A rising `weapon.cooldownLeft` is a round
   * leaving and a falling `hp` is one arriving, and both are right there in the
   * world when the frame is drawn.
   */
  private beat(robot: RobotEntity, now: number): number {
    const dt = Math.min(Math.max((now - this.pilot.at) / 1000, 0), 0.25);
    const last = this.last;
    if (last.id !== robot.id) {
      // A different hull: its cooldown and hp are not this one's history, and
      // differencing them would open with a phantom shot or a phantom hit.
      this.rig.reset();
      this.dead = 0;
      this.shot = false;
      this.hit = 0;
    } else {
      this.shot = robot.weapon.cooldownLeft > last.cooldown;
      this.hit = robot.hp < last.hp ? (last.hp - robot.hp) / Math.max(robot.maxHp, 1) : 0;
    }
    last.id = robot.id;
    last.cooldown = robot.weapon.cooldownLeft;
    last.hp = robot.hp;
    return dt;
  }

  private drawUnits(frame: FpvFrame, view: FpvProjection): void {
    const { world, isVisible, robot: possessed } = frame;
    const g = this.units;
    g.clear();

    for (const base of bases(world)) {
      if (!isAlive(base) || !isVisible(base)) continue;
      const color = this.roleColor(base, possessed);
      // Two draws, because the two point different ways: `base.heading` is the
      // battery's bearing (written by `taskSystem`'s turret pass), not the
      // building's. One model would swing the whole structure round on every shot.
      this.drawModel(view, BASE_BODY, base.position, 0, color, COLD);
      this.drawModel(view, BASE_LAUNCHER, base.position, base.heading, color, baseHeat(base));
    }
    const pilotDrive = this.pilotDrive(possessed, frame.now);
    for (const r of robots(world)) {
      if (!isAlive(r) || !isVisible(r)) continue;
      const model = ROBOT_MODELS[r.chassis][r.weaponType];
      const heat = robotHeat(r);
      if (r.id === possessed.id) heat.drive = pilotDrive;
      this.drawModel(view, model, r.position, r.heading, this.roleColor(r, possessed), heat);
    }
    // Rounds in flight. Untinted by owner and drawn with the heat pass — see
    // `PROJECTILE_MODEL`. Not gated on `isVisible`: a projectile carries no owner
    // tag the fog reads, and the top view does not hide them either.
    for (const p of projectiles(world)) {
      this.drawModel(view, PROJECTILE_MODEL, p.position, Math.atan2(p.velocity.y, p.velocity.x), palette.fpv.foe, {
        drive: 0,
        barrel: 1,
      });
    }
    for (const m of munitions(world)) {
      if (!isAlive(m) || !isVisible(m)) continue;
      this.drawModel(view, MUNITION_MODEL, m.position, m.heading, this.roleColor(m, possessed), COLD);
    }
    for (const d of drones(world)) {
      if (!isAlive(d) || !isVisible(d)) continue;
      // A drone inside a hull is glued to that hull's position, so drawing it puts a
      // second box on top of a machine already on screen — and the pilot's own drone
      // would hang over their own roof, in the middle of the picture, all match.
      // While it is riding, the hull *is* where it is.
      if (d.drone.possessedId) continue;
      this.drawModel(view, DRONE_MODEL, d.position, d.heading, this.roleColor(d, possessed), COLD);
    }

    this.drawFireMark(frame, view, possessed);
  }

  /**
   * Bracket whatever `E` would shoot at.
   *
   * The answer comes from `manualFireTarget` — the very function the trigger uses —
   * rather than from anything this file works out about ranges. It is the only thing
   * on the monitor that says a weapon can reach: a cannon's 180 px stops barely past
   * the hull's own nose on screen, so a pilot with no mark is guessing, which is
   * exactly what "I pressed E and nothing happened" was.
   *
   * Drawn last, over every contour, because it is something said *about* a machine.
   */
  private drawFireMark(frame: FpvFrame, view: FpvProjection, possessed: RobotEntity): void {
    if (!frame.ctx) return;
    const target = manualFireTarget(frame.ctx, possessed);
    // The gate the rest of the view uses. A launcher can reach a great deal further
    // than this side can see, and marking a machine it has not detected would hand
    // out the intel every other line in this file is careful not to.
    if (!target || !frame.isVisible(target)) return;

    const dist = Math.hypot(target.position.x - view.eye.x, target.position.y - view.eye.y);
    if (dist > FADE.end) return;
    const model = target.base ? BASE_BODY : ROBOT_MODELS[target.chassis][target.weaponType];
    const z = this.heights?.at(target.position.x, target.position.y) ?? 0;
    // A base is drawn square to the world, so its bracket is measured that way too.
    const heading = target.base ? 0 : target.heading;
    const bounds = screenBoundsOf(view, model, { x: target.position.x, y: target.position.y, z, heading });
    if (bounds) drawTargetMark(this.units, bounds, 1 - Math.max(0, dist - FADE.start) / Math.max(FADE.end - FADE.start, 1));
  }

  /**
   * How hard the pilot's own hull is driving — measured here, because it is the one
   * machine in the world whose `movement.velX/velY` is not the answer.
   *
   * A possessed hull is steered by `droneSystem`, which moves `position` directly;
   * `movementSystem` runs after it and records only what its *own* pass drove, which
   * for a hull with no destination is nothing. So the simulation honestly reports the
   * pilot's machine as parked while the player is holding the stick down — and that
   * machine is the one thing on this screen at all times, so a dead drive on it reads
   * as the feature being broken rather than as the hull standing still.
   *
   * Measured off ground covered between frames, which is the same clock
   * `render/gait.ts` and `render/dust.ts` run on and for the same reason: it is the
   * honest answer whatever is doing the moving. Smoothed exponentially and
   * frame-rate independently, because the simulation steps at 30 Hz and the view
   * does not — two frames inside one tick would otherwise read as a full stop.
   *
   * Deliberately **not** generalised to every machine: everything else is driven by
   * `movementSystem` and already carries a truthful velocity, and shadowing that with
   * a renderer-side table of previous positions would be a second source of truth
   * that has to be evicted as entities die.
   */
  private pilotDrive(robot: RobotEntity, now: number): number {
    const p = this.pilot;
    const dt = (now - p.at) / 1000;
    const moved = Math.hypot(robot.position.x - p.x, robot.position.y - p.y);
    p.x = robot.position.x;
    p.y = robot.position.y;
    p.at = now;
    // A different hull (or the first frame in this one) has no history to difference
    // against, and the jump from the last one's position would read as a lurch.
    if (p.id !== robot.id || dt <= 0 || dt > 0.5) {
      p.id = robot.id;
      p.drive = 0;
      return 0;
    }
    const top = robot.movement.speed;
    const instant = top > 0 ? Math.min(1, moved / dt / top) : 0;
    p.drive += (instant - p.drive) * (1 - Math.exp(-dt / DRIVE_SMOOTHING));
    return p.drive;
  }

  /**
   * Which of the three roles a machine wears. Keyed off the possessed hull's own
   * owner rather than the store's `localSide`: the pilot is by definition sitting in
   * one of their own machines, so the hull answers the question without this file
   * having to know anything about who is playing.
   */
  private roleColor(e: Entity, possessed: RobotEntity): number {
    if (e.id === possessed.id) return palette.fpv.self;
    return e.owner === possessed.owner ? palette.fpv.friend : palette.fpv.foe;
  }

  /** Range gate + fade, then hand the model to `units.ts` to rotate, project and stroke. */
  private drawModel(
    view: FpvProjection,
    model: Model,
    pos: { x: number; y: number },
    heading: number,
    color: number,
    heat: Heat,
  ): void {
    const dist = Math.hypot(pos.x - view.eye.x, pos.y - view.eye.y);
    if (dist > FADE.end) return; // past the monitor's range — nothing to draw, and nothing to project
    const alpha = 1 - Math.max(0, dist - FADE.start) / Math.max(FADE.end - FADE.start, 1);
    const z = this.heights?.at(pos.x, pos.y) ?? 0;
    drawUnit(this.units, view, model, { x: pos.x, y: pos.y, z, heading }, { color, alpha, heat });
  }

  private clearTerrain(): void {
    // `Mesh.destroy` releases its texture, never its geometry — and the geometry is
    // the only large thing here (two buffers over every line on the map).
    this.terrain?.geometry.destroy();
    this.terrain?.destroy();
    this.terrain = null;
    // Without `true`, deliberately: `GlProgram.from` caches by source, so the next
    // match's shader is the same program object and destroying it here would leave
    // the second match of a session drawing nothing.
    this.shader?.destroy();
    this.shader = null;
    this.uniforms = null;
    this.fogMask?.destroy();
    this.fogMask = null;
    this.heights = null;
  }

  destroy(): void {
    this.clearTerrain();
    this.container.filters = [];
    this.feed?.destroy();
    this.container.destroy({ children: true });
  }
}
