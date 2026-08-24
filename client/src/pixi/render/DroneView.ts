import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import { DRONE_CYCLE_MS } from '../../config/sprites';
import type { DroneEntity } from '../../engine/ecs/archetypes';
import { useGameStore } from '../../store/gameStore';
import { getDroneCycleTextures, getDroneTexture, type ResolvedSprite } from '../assets';
import { cellAt } from './cycle';
import { HealthBar } from './HealthBar';
import { ownerColor } from './ownerColor';

/** Bar width (px) and how far above the drone it floats. */
const HP_BAR_WIDTH = 22;
const HP_BAR_OFFSET = 18;

/**
 * How hard a flying drone pitches into its course, as a fraction of its length.
 *
 * A quad-rotor tilts nose-down to move, and from directly overhead a tilt is
 * **foreshortening**: the airframe gets shorter along the way it is going and no
 * narrower across. So this is a scale, not a rotation — 0.18 is enough to read at
 * 40 px without the drone looking crushed. The cross-axis gets half of it back,
 * which is what keeps a pitched drone the same visual mass as a level one.
 */
const PITCH = 0.18;
/** Seconds for the pitch to build from a standstill, or to level back out. */
const LEAN_EASE_S = 0.15;
/** Below this the drone is treated as stopped and snapped level. */
const LEAN_REST = 0.02;
/** Frame-time ceiling (s) for the easing, so a stalled tab doesn't jump it. */
const MAX_DT = 0.1;
/** Sideways tremble at full speed — amplitude (px) and how fast it shakes (ms/radian). */
const TREMOR_PX = 1;
const TREMOR_MS = 18;
/**
 * Holding station: how far the drone wanders (px), how much of its size it gains and
 * loses riding its own downwash, and the period of each.
 *
 * **The wander is the part that reads, and the sizes here are the whole point.** The
 * drone is 40 px on a camera with no zoom, so a cue measured in fractions of a pixel
 * does not exist — the first pass at this used a ±2% scale, which is ±0.8 px, and was
 * invisible in a side-by-side of two frames. A 2 px wander is 5% of the airframe and
 * moves the whole silhouette against a background that is holding perfectly still,
 * which is what makes it legible where the scale alone was not. The two periods are
 * deliberately not multiples of each other, so the drift never settles into a
 * metronome.
 */
const HOVER_DRIFT_PX = 2;
const HOVER_DRIFT_MS = 2600;
const HOVER_SCALE = 0.035;
const HOVER_SCALE_MS = 1700;

/**
 * View for a side's observer drone: a small diamond marker (so it reads as a
 * flyer, not a ground unit). Lives on the `overlay` layer so it draws above fog
 * and units. `body` rotates with heading; an HP bar appears only once the drone
 * has taken anti-air damage, so an untouched one stays uncluttered.
 *
 * **Three things say it is airborne, and only one of them is art.** The sheet
 * (`droneCycleSprites`) breathes its camera eye and runs a light around the arms;
 * the other two are computed here and work with no art at all — the airframe
 * *pitches* into its course while flying, and *drifts* up and down while holding
 * station. That split is the same one `robots.md` argues for the ground units: at
 * 40 px, what happens inside the silhouette is a couple of pixels, so the shape of
 * the silhouette has to carry the movement.
 *
 * Every side flies one, and there is only **one** drone art set — unlike robots
 * and bases, which have two, so `teamTint` leaves those alone in a 1v1. An
 * untinted enemy drone would therefore look pixel-for-pixel like your own,
 * which is misinformation rather than a missing polish pass. So the local side
 * keeps the authored look and every other side is recoloured by `ownerColor`.
 */
export class DroneView {
  readonly container: Container;
  private readonly body: Container;
  private readonly hpBar: HealthBar;
  /** The hover-cycle cells, or null when the sheet has not been drawn. */
  private readonly frames: ResolvedSprite[] | null;
  /** The sprite the cycle swaps textures on; null when the art fell back to Graphics. */
  private readonly img: Sprite | null = null;
  /** Where this drone sits in the cycle, so two on screen do not blink together. */
  private readonly phase: number;
  private frame = 0;
  /** How far into its pitch the drone is, in `[0, 1]` — eased, never switched. */
  private lean = 0;
  private lastX = 0;
  private lastY = 0;
  private lastNow = 0;

  constructor(drone: DroneEntity) {
    this.container = new Container();
    this.container.label = `drone:${drone.id}`;
    // Visual only: prune from hit-testing so it never swallows clicks meant
    // for robots in the units layer beneath it.
    this.container.eventMode = 'none';

    // undefined = leave the art exactly as authored (the local side's own eye).
    const tint = drone.owner === useGameStore.getState().localSide ? undefined : ownerColor(drone.owner);

    this.body = new Container();
    this.frames = getDroneCycleTextures();
    // Cell 0 is the rest pose, so it is also what to show on the first frame — and
    // it is what the still sprite is cut from.
    const sprite = this.frames?.[0] ?? getDroneTexture();
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? gameConfig.grid.tilePx * 1.25;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      img.rotation = def.rotationOffset ?? 0;
      if (tint !== undefined) img.tint = tint;
      this.body.addChild(img);
      this.img = img;
    } else {
      const r = gameConfig.robots.radius * 0.9;
      const g = new Graphics();
      g.poly([0, -r, r, 0, 0, r, -r, 0])
        .fill({ color: tint ?? palette.drone.body })
        .stroke({ width: 2, color: tint ?? palette.drone.edge });
      g.circle(0, 0, 2.5).fill(tint ?? palette.drone.edge);
      this.body.addChild(g);
    }
    this.container.addChild(this.body);

    this.hpBar = new HealthBar(HP_BAR_WIDTH);
    this.hpBar.container.position.set(0, -HP_BAR_OFFSET);
    this.container.addChild(this.hpBar.container);

    // Off the id rather than the position: a drone spends the match moving, so a
    // positional hash would re-roll its phase every frame.
    this.phase = hashPhase(drone.id);
    this.lastX = drone.position.x;
    this.lastY = drone.position.y;
    this.lastNow = performance.now();

    this.update(drone, true, this.lastNow);
  }

  update(drone: DroneEntity, visible: boolean, now: number): void {
    // The overlay layer draws above the fog, so a drone the local side hasn't
    // detected has to be hidden outright — the fog can't cover it.
    this.container.visible = visible;
    if (drone.position) this.container.position.set(drone.position.x, drone.position.y);
    this.body.rotation = drone.heading;

    const maxHp = drone.maxHp;
    const hp = drone.hp;
    this.hpBar.container.visible = maxHp > 0 && hp < maxHp;
    if (this.hpBar.container.visible) this.hpBar.set(hp / maxHp);

    this.fly(drone, visible, now);
  }

  /**
   * Everything the drone does *because it is a flying machine*: which cell of the
   * hover sheet is up, how hard it is pitched into its course, and the drift it holds
   * station with.
   *
   * The travel delta is measured on every frame but only **spent** when the drone is
   * on screen — the same rule `RobotView.move` follows, and for the same reason: a
   * flight made out of sight would otherwise be repaid in one lump the moment it is
   * seen again, snapping the drone into a full pitch it never flew.
   */
  private fly(drone: DroneEntity, visible: boolean, now: number): void {
    const dx = drone.position.x - this.lastX;
    const dy = drone.position.y - this.lastY;
    this.lastX = drone.position.x;
    this.lastY = drone.position.y;

    const dt = Math.min((now - this.lastNow) / 1000, MAX_DT);
    this.lastNow = now;

    // Riding a robot is not flying. Without this the drone would pitch every time the
    // hull under it walked, which reads as the drone straining against its own landing
    // pad — and it is glued to that hull, so the movement is not even its own.
    const flying = visible && !drone.drone.possessedId && Math.hypot(dx, dy) > 0;
    this.lean += ((flying ? 1 : 0) - this.lean) * Math.min(1, dt / LEAN_EASE_S);
    if (this.lean < LEAN_REST) this.lean = 0;

    // `body.rotation` is the heading, so the container's local +x already points the
    // way the drone is going: shortening along it *is* the nose-down foreshortening.
    // A hovering drone spends that budget on the altitude drift instead — the two
    // never overlap, which is what keeps a pitched drone from also breathing.
    const still = 1 - this.lean;
    const turn = (now / HOVER_SCALE_MS + this.phase) * Math.PI * 2;
    const hover = still * Math.sin(turn) * HOVER_SCALE;
    this.body.scale.set(1 + hover - this.lean * PITCH, 1 + hover + this.lean * PITCH * 0.5);

    // Two channels on `body.position`, and only one of them is ever live: a drone is
    // either holding station (wandering) or flying (trembling). The wander is a circle
    // rather than a line so it never reads as a slider being dragged; the tremble is
    // sideways in the container's *unrotated* space, so it crosses the course instead
    // of running along it.
    const drift = (now / HOVER_DRIFT_MS + this.phase) * Math.PI * 2;
    const tremor = Math.sin(now / TREMOR_MS) * TREMOR_PX * this.lean;
    this.body.position.set(
      still * Math.cos(drift) * HOVER_DRIFT_PX - Math.sin(drone.heading) * tremor,
      still * Math.sin(drift * 0.7) * HOVER_DRIFT_PX + Math.cos(drone.heading) * tremor,
    );

    if (!this.frames || !this.img) return;
    const cell = cellAt(now, DRONE_CYCLE_MS, this.phase, this.frames.length);
    if (cell !== this.frame) {
      this.frame = cell;
      this.img.texture = this.frames[cell].texture;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** A stable `[0, 1)` phase from an entity id, so two drones never pulse in step. */
function hashPhase(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h / 0x100000000;
}
