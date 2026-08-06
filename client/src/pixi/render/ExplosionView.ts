import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import { EffectKind, type Entity } from '../../engine/ecs/entity';
import { clamp, lerp } from '../../utils/math';

/** Radial arcs on a directed-energy discharge — enough to read as a snap, few enough to stay sharp. */
const ARC_COUNT = 6;

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

  constructor(explosion: Entity) {
    this.container = new Container();
    this.container.label = `boom:${explosion.id}`;
    if (explosion.position) this.container.position.set(explosion.position.x, explosion.position.y);

    this.blast = new Graphics();
    this.container.addChild(this.blast);
    this.update(explosion);
  }

  update(explosion: Entity): void {
    const fx = explosion.effect;
    if (!fx) return;
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
