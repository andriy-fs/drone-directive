import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { ProjectileEntity } from '../../engine/ecs/archetypes';
import { WeaponType } from '@drone-directive/types/enums';
import { perfFlags } from '../perf/perfFlags';
import { ownerColor } from './ownerColor';

/** Head radius of a directed-energy bolt — twice a bullet's, so it reads as energy, not a shell. */
const DEW_CORE_RADIUS = gameConfig.combat.projectileRadius * 2;

/** Missile exhaust pulses per second. Fast enough to read as burning, slow enough not to strobe. */
const EXHAUST_HZ = 22;

/** How fast the wobble travels along a directed-energy bolt, radians per second. */
const CRACKLE_HZ = 9;

/**
 * Projectile view: cannon fire is a bright tracer dot with a fading streak;
 * missiles are a bigger rocket body with a flickering exhaust flame and a smoke
 * ribbon, rotated to face its (constant) travel direction; a directed-energy shot
 * is a pale electric bolt that crackles instead of trailing smoke — it deals no
 * damage, so it must not look like a shell. `weaponType` on the projectile entity
 * picks the look — see `spawnProjectile`.
 *
 * **The trail is what carries readability, not the body.** A round is a handful
 * of pixels on a field with no zoom, so what makes it legible is drawn behind it
 * — `dust.ts` makes the same argument at length for a moving hull, and it holds
 * unchanged here. The trail is sampled from the projectile's own world positions
 * and drawn in world space, so it stays where the round has *been* rather than
 * rotating with the body.
 *
 * **Everything animates off the frame clock**, not off `Math.random()` per frame.
 * A re-rolled exhaust strobes at whatever rate the renderer happens to be running
 * at; a pulsed one burns.
 */
export class ProjectileView {
  readonly container: Container;
  /** Trail + exhaust, in world space — see `drawTrail`. Null for a `dew` bolt, which leaves none. */
  private readonly trail: Graphics | null = null;
  /** Redrawn every frame (missile exhaust / dew discharge); null for a plain tracer. */
  private readonly flicker: Graphics | null = null;
  /** Everything that rotates with the round. World-space art must not go in here. */
  private readonly body: Container;
  private readonly kind: 'missile' | 'dew' | 'tracer';
  /** Recent world positions, oldest first. Capped at `fx.trail.samples`. */
  private readonly samples: { x: number; y: number }[] = [];
  /** Clock reading of the last sample, so the trail is laid down at a rate, not per frame. */
  private lastSample = 0;
  /**
   * Phase offset, fixed per round. Without it every missile on screen pulses in
   * lockstep — the one artefact that gives away that they share a clock.
   */
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(projectile: ProjectileEntity) {
    this.container = new Container();
    this.container.label = `proj:${projectile.id}`;

    const color = ownerColor(projectile.owner);
    const v = projectile.velocity;

    // Two children, and the split is load-bearing: `trail` is drawn in world
    // coordinates and must never rotate, while `body` is rotated once to travel
    // direction and everything inside it is drawn pointing along +x.
    if (perfFlags.fx) {
      this.trail = new Graphics();
      this.container.addChild(this.trail);
    }
    this.body = new Container();
    this.body.rotation = v ? Math.atan2(v.y, v.x) : 0;
    this.container.addChild(this.body);

    if (projectile.weaponType === WeaponType.Missiles) {
      this.kind = 'missile';
      // Rocket body (nose + tail), drawn pointing along +x — the body's rotation aims it.
      const hull = new Graphics();
      hull.poly([9, 0, -4, -3.5, -4, 3.5]).fill(color).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
      this.flicker = new Graphics();
      this.body.addChild(this.flicker, hull);
    } else if (projectile.weaponType === WeaponType.Dew) {
      this.kind = 'dew';
      // A bolt, not a bullet. Deliberately the loudest projectile in the game:
      // it deals no damage, so if the player can't see it land they read the
      // whole weapon as broken. Halo + white-hot core, with the crackle on top.
      const halo = new Graphics();
      halo.circle(0, 0, DEW_CORE_RADIUS * 2.6).fill({ color: palette.status.disabled, alpha: 0.28 });
      const core = new Graphics();
      core
        .circle(0, 0, DEW_CORE_RADIUS)
        .fill(0xffffff)
        .stroke({ width: 2, color: palette.status.disabled, alpha: 0.95 });
      this.flicker = new Graphics();
      this.body.addChild(halo, this.flicker, core);
    } else {
      this.kind = 'tracer';
      // Cannon: a bright core. The streak behind it is the world-space trail.
      const core = new Graphics();
      core
        .circle(0, 0, gameConfig.combat.projectileRadius)
        .fill(color)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
      this.body.addChild(core);
    }

    this.update(projectile, 0);
  }

  update(projectile: ProjectileEntity, now: number): void {
    const { x, y } = projectile.position;
    this.container.position.set(x, y);
    // The trail is drawn in world space inside a container that has been moved to
    // the round's position, so it is offset back by that position — which is what
    // keeps it anchored to the ground instead of dragged along.
    if (this.trail) this.trail.position.set(-x, -y);
    this.sample(x, y, now);
    this.drawTrail(x, y);
    this.drawFlicker(now);
  }

  /** Bank one position every `fx.trail.interval`, discarding the oldest past the cap. */
  private sample(x: number, y: number, now: number): void {
    if (!this.trail) return;
    const { samples, interval } = gameConfig.fx.trail;
    // A round lives 1.5 s at most, so there is no need to seed a history: the
    // first frame is genuinely the start of the trail.
    if (this.lastSample !== 0 && now - this.lastSample < interval * 1000) return;
    this.lastSample = now;
    if (this.samples.length >= samples) this.samples.shift();
    this.samples.push({ x, y });
  }

  /**
   * The ribbon, drawn as a chain of tapering segments from the oldest sample to
   * the round itself.
   *
   * Per-segment rather than one stroked polyline because the taper is the point:
   * both the width and the alpha ramp from nothing at the tail to full at the
   * head, which is what makes it read as something being *left behind* rather
   * than as a drawn line that happens to end at a dot.
   */
  private drawTrail(x: number, y: number): void {
    const g = this.trail;
    if (!g || this.kind === 'dew') return;
    g.clear();
    const n = this.samples.length;
    if (n < 2) return;

    const missile = this.kind === 'missile';
    const width = missile ? gameConfig.fx.trail.missileWidth : gameConfig.fx.trail.tracerWidth;
    const color = missile ? palette.fx.smoke : palette.fx.tracer;
    const peak = missile ? 0.5 : 0.42;

    for (let i = 1; i < n; i++) {
      const t = i / (n - 1);
      const a = this.samples[i - 1];
      const b = this.samples[i];
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: Math.max(0.4, width * t), color, alpha: peak * t * t });
    }
    // …and close the gap between the newest sample and where the round actually
    // is this frame, or the head of the trail visibly lags the body it belongs to.
    const last = this.samples[n - 1];
    g.moveTo(last.x, last.y).lineTo(x, y).stroke({ width, color, alpha: peak });
  }

  /** The burning part: exhaust for a missile, discharge for a bolt. Pulsed on the shared clock. */
  private drawFlicker(now: number): void {
    if (!this.flicker) return;
    const t = now / 1000;
    this.flicker.clear();

    if (this.kind === 'missile') {
      // Two overlapping cones — a long, faint outer flame and a short bright
      // core — so the exhaust has depth rather than being one flat triangle.
      const pulse = 0.5 + 0.5 * Math.sin(t * EXHAUST_HZ + this.phase);
      const len = 8 + pulse * 6;
      this.flicker
        .poly([-4, -2.6, -4, 2.6, -4 - len, 0])
        .fill({ color: palette.fx.exhaust, alpha: 0.55 + pulse * 0.3 })
        .poly([-4, -1.4, -4, 1.4, -4 - len * 0.5, 0])
        .fill({ color: palette.fx.flash, alpha: 0.65 + pulse * 0.25 });
      return;
    }

    // Dew: a lightning tail whipping behind the core (the body is already rotated
    // to travel direction, so -x is "behind"). The wobble *travels* along the
    // bolt — each node is the same wave sampled a little further along — which is
    // what separates a charged arc from noise re-rolled every frame.
    const wave = (i: number) => Math.sin(t * CRACKLE_HZ + this.phase + i * 2.1) * 3.5;
    this.flicker
      .moveTo(DEW_CORE_RADIUS, 0)
      .lineTo(-6, wave(1))
      .lineTo(-13, wave(2))
      .lineTo(-20, wave(3))
      .stroke({ width: 2, color: palette.status.disabled, alpha: 0.75 + 0.25 * Math.sin(t * CRACKLE_HZ * 2) })
      // …plus a short cross-spark through the head, so it reads as charged even
      // in a still frame.
      .moveTo(-2, -6 + wave(4) * 0.3)
      .lineTo(4, 6 + wave(5) * 0.3)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.5 + 0.4 * Math.sin(t * CRACKLE_HZ * 1.7 + this.phase) });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
