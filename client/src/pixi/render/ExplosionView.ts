import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import type { Entity } from '../../engine/ecs/entity';
import { clamp, lerp } from '../../utils/math';

/**
 * Placeholder explosion: a circle that grows and fades over the effect's
 * lifetime, driven by `effect.age / effect.duration`.
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
    const radius = lerp(4, fx.maxRadius ?? gameConfig.fx.explosionMaxRadius, t);
    const alpha = 1 - t;

    this.blast.clear();
    this.blast
      .circle(0, 0, radius)
      .fill({ color: 0xffb020, alpha: alpha * 0.8 })
      .stroke({ width: 2, color: 0xff5522, alpha });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
