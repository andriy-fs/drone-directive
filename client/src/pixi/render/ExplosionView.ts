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

/**
 * Transient effect: a shape that grows and fades over the effect's lifetime,
 * driven by `effect.age / effect.duration`. `effect.kind` picks which — a
 * fireball for a death or a kamikaze, an electric discharge for a directed-energy
 * hit. The discharge is deliberately a *ring* rather than a filled disc: it has
 * to announce a status effect without looking like something exploded.
 */
export class ExplosionView {
  readonly container: Container;
  private readonly blast: Graphics;

  constructor(explosion: ExplosionEntity) {
    this.container = new Container();
    this.container.label = `boom:${explosion.id}`;
    if (explosion.position) this.container.position.set(explosion.position.x, explosion.position.y);

    this.blast = new Graphics();
    this.container.addChild(this.blast);
    this.update(explosion);
  }

  update(explosion: ExplosionEntity): void {
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

    const radius = lerp(4, fx.maxRadius ?? gameConfig.fx.explosionMaxRadius, t);
    this.blast
      .circle(0, 0, radius)
      .fill({ color: 0xffb020, alpha: alpha * 0.8 })
      .stroke({ width: 2, color: 0xff5522, alpha });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
