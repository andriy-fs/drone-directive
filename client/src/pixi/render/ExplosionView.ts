import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { ExplosionEntity } from '../../engine/ecs/archetypes';
import { EffectKind } from '../../engine/ecs/entity';
import { clamp, lerp } from '../../utils/math';

/** Radial arcs on a directed-energy discharge — enough to read as a snap, few enough to stay sharp. */
const ARC_COUNT = 6;

/** Shards thrown off a shattering energy dome — sparse enough to read as pieces, not a ring. */
const SHARD_COUNT = 8;

/** Vertices on a fireball's rim. Enough to look torn, few enough that the shape still reads as round. */
const RIM_POINTS = 14;

/** How far a rim vertex may sit from the mean radius, as a fraction of it. */
const RIM_ROUGHNESS = 0.22;

/** Ember streaks drawn on the fireball itself (the thrown ones live in the particle field). */
const STREAK_COUNT = 7;

/**
 * Transient effect: a shape that grows and fades over the effect's lifetime,
 * driven by `effect.age / effect.duration`. `effect.kind` picks which — a
 * fireball for a death or a kamikaze, an electric discharge for a directed-energy
 * hit. The discharge is deliberately a *ring* rather than a filled disc: it has
 * to announce a status effect without looking like something exploded.
 *
 * **This view draws only what is tied to the entity's own clock.** The debris an
 * explosion throws — embers, smoke, the burn on the ground — outlives the entity
 * by design and belongs to the particle field instead; `WorldRenderer` hands it
 * off through `onBlast` at the moment the entity appears. The split is what lets
 * smoke still be drifting a second after the fire is gone.
 */
export class ExplosionView {
  readonly container: Container;
  private readonly blast: Graphics;
  /**
   * Per-blast rim roughness, rolled once at construction. Re-rolling it per frame
   * is the difference between a fireball with a torn edge and one that boils.
   */
  private readonly rim: number[] = [];

  constructor(explosion: ExplosionEntity) {
    this.container = new Container();
    this.container.label = `boom:${explosion.id}`;
    if (explosion.position) this.container.position.set(explosion.position.x, explosion.position.y);

    for (let i = 0; i < RIM_POINTS; i++) this.rim.push(1 + (Math.random() * 2 - 1) * RIM_ROUGHNESS);

    this.blast = new Graphics();
    this.container.addChild(this.blast);
    this.update(explosion, 0);
  }

  update(explosion: ExplosionEntity, now: number): void {
    const fx = explosion.effect;
    const t = clamp(fx.age / fx.duration, 0, 1);
    const alpha = 1 - t;

    this.blast.clear();

    if (fx.kind === EffectKind.Emp) {
      const radius = lerp(6, fx.maxRadius ?? gameConfig.fx.empBurstMaxRadius, t);
      // Two rings racing outward plus radial arcs — an electrical snap, and it
      // stays legible over the sprite it is drawn on top of.
      this.blast
        .circle(0, 0, radius)
        .stroke({ width: 3, color: palette.status.disabled, alpha })
        .circle(0, 0, radius * 0.55)
        .stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.85 });
      for (let i = 0; i < ARC_COUNT; i++) {
        const a = (Math.PI * 2 * i) / ARC_COUNT + t * 1.5;
        this.blast
          .moveTo(Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5)
          .lineTo(Math.cos(a) * radius * 1.15, Math.sin(a) * radius * 1.15);
      }
      this.blast.stroke({ width: 2, color: palette.status.disabled, alpha: alpha * 0.9 });
      return;
    }

    // The two ways a base's energy dome can end. They are drawn as opposites on
    // purpose — the player has to know at a glance whether the dome was beaten
    // down or simply ran out, because only one of those is their own fault.
    if (fx.kind === EffectKind.ShieldBreak || fx.kind === EffectKind.ShieldExpire) {
      const full = fx.maxRadius ?? gameConfig.bases.shield.radius;
      if (fx.kind === EffectKind.ShieldBreak) {
        // Shattered: the shell holds its size and comes apart, shards thrown
        // outward. Alpha drops off fast (squared), so it reads as a snap.
        const shell = lerp(full, full * 1.08, t);
        this.blast.circle(0, 0, shell).stroke({ width: 3, color: palette.shield.hit, alpha: alpha * alpha });
        for (let i = 0; i < SHARD_COUNT; i++) {
          const a = (Math.PI * 2 * i) / SHARD_COUNT;
          const from = lerp(full * 0.85, full * 1.1, t);
          const to = lerp(full * 0.95, full * 1.45, t);
          this.blast
            .moveTo(Math.cos(a) * from, Math.sin(a) * from)
            .lineTo(Math.cos(a) * to, Math.sin(a) * to);
        }
        this.blast.stroke({ width: 3, color: palette.shield.glow, alpha });
        return;
      }
      // Powered down: one ring contracting onto the base, no shards, long soft
      // ramp. Nothing broke — the generator simply stopped.
      this.blast
        .circle(0, 0, lerp(full, full * 0.82, t))
        .stroke({ width: 2, color: palette.shield.glow, alpha: alpha * 0.7 });
      return;
    }

    this.drawFireball(t, alpha, fx.maxRadius ?? gameConfig.fx.explosionMaxRadius, now);
  }

  /**
   * The fireball, in four stages read off one `t`. They are layered back to front
   * in the order they cool: shockwave, body, streaks, then the ignition flash on
   * top of everything while it lasts.
   *
   * Two things make this read as an explosion rather than as a growing circle,
   * and both are cheap: the rim is **torn** (a polygon with per-vertex noise
   * fixed at construction, not a perfect circle), and the growth **eases out**
   * — a blast expands hard and then stalls, where a linear `lerp` looks like
   * something being inflated.
   */
  private drawFireball(t: number, alpha: number, max: number, now: number): void {
    const g = this.blast;
    // Ease-out cubic. The whole difference between "it detonated" and "it grew".
    const eased = 1 - (1 - t) ** 3;
    const radius = lerp(4, max, eased);

    // 1. Shockwave: a thin ring that outruns the fire and is gone by mid-life.
    //    This is what communicates *reach* — it matters for a 120 px kamikaze,
    //    where the fireball itself is smaller than the damage it did.
    if (t < 0.55) {
      const wave = 1 - t / 0.55;
      g.circle(0, 0, radius * (1.15 + t * 0.9)).stroke({
        width: 1 + wave * 2,
        color: palette.fx.fireEdge,
        alpha: wave * wave * 0.55,
      });
    }

    // 2. The body, with a torn rim. Filled in the cooling colour and stroked in
    //    the hotter one, so the edge stays the brightest part as it fades.
    g.poly(this.rimPoints(radius))
      .fill({ color: palette.fx.fireCore, alpha: alpha * 0.8 })
      .stroke({ width: 2, color: palette.fx.fireEdge, alpha });

    // 3. Ember streaks over the body, drifting outward. Sparse, and they inherit
    //    the effect's own phase from `now` so several blasts at once do not all
    //    point the same way.
    if (t > 0.1) {
      const spin = now / 4000;
      for (let i = 0; i < STREAK_COUNT; i++) {
        const a = (Math.PI * 2 * i) / STREAK_COUNT + spin + this.rim[i];
        g.moveTo(Math.cos(a) * radius * 0.35, Math.sin(a) * radius * 0.35).lineTo(
          Math.cos(a) * radius * (0.8 + eased * 0.5),
          Math.sin(a) * radius * (0.8 + eased * 0.5),
        );
      }
      g.stroke({ width: 1.5, color: palette.fx.spark, alpha: alpha * 0.7 });
    }

    // 4. Ignition, on top and gone in the first fifth of the life. A blast has to
    //    have a moment of *being lit*; without this the first frame is simply the
    //    smallest frame of a fade.
    if (t < 0.2) {
      const flash = 1 - t / 0.2;
      g.circle(0, 0, radius * (0.5 + flash * 0.6)).fill({ color: palette.fx.flash, alpha: flash * 0.95 });
    }
  }

  /** The torn rim as a flat `[x, y, …]` list, the per-vertex noise scaled to the current radius. */
  private rimPoints(radius: number): number[] {
    const pts: number[] = [];
    for (let i = 0; i < RIM_POINTS; i++) {
      const a = (Math.PI * 2 * i) / RIM_POINTS;
      const r = radius * this.rim[i];
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    return pts;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
