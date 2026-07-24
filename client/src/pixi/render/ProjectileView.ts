import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { Owner, WeaponType } from '../../types/enums';

/**
 * Projectile view: cannon fire is a bright tracer dot with a short streak;
 * missiles are a bigger rocket body with a flickering exhaust flame, rotated
 * to face its (constant) travel direction. `weaponType` on the projectile
 * entity picks the look — see `spawnProjectile`.
 */
export class ProjectileView {
  readonly container: Container;
  private readonly flame: Graphics | null = null;

  constructor(projectile: Entity) {
    this.container = new Container();
    this.container.label = `proj:${projectile.id}`;

    const color = projectile.owner === Owner.Player ? palette.owner.player : palette.owner.ai;
    const v = projectile.velocity;
    this.container.rotation = v ? Math.atan2(v.y, v.x) : 0;

    if (projectile.weaponType === WeaponType.Missiles) {
      // Rocket body (nose + tail), drawn pointing along +x — container rotation aims it.
      const body = new Graphics();
      body.poly([9, 0, -4, -3.5, -4, 3.5]).fill(color).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
      this.flame = new Graphics();
      this.container.addChild(this.flame, body);
      this.drawFlame();
    } else {
      // Cannon: a bright core with a short tracer streak behind it.
      const tracer = new Graphics();
      tracer.poly([0, -1, -9, 0, 0, 1]).fill({ color: 0xfff7ed, alpha: 0.45 });
      const core = new Graphics();
      core
        .circle(0, 0, gameConfig.combat.projectileRadius)
        .fill(color)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });
      this.container.addChild(tracer, core);
    }

    this.update(projectile);
  }

  update(projectile: Entity): void {
    if (projectile.position) this.container.position.set(projectile.position.x, projectile.position.y);
    this.drawFlame();
  }

  /** Redrawn every tick so the exhaust flickers in length/alpha. */
  private drawFlame(): void {
    if (!this.flame) return;
    const len = 7 + Math.random() * 5;
    this.flame
      .clear()
      .poly([-4, -2.5, -4, 2.5, -4 - len, 0])
      .fill({ color: 0xfbbf24, alpha: 0.6 + Math.random() * 0.3 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
