import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { WeaponType } from '@drone-directive/types/enums';
import { ownerColor } from './ownerColor';

/**
 * Projectile view: cannon fire is a bright tracer dot with a short streak;
 * missiles are a bigger rocket body with a flickering exhaust flame, rotated
 * to face its (constant) travel direction; a directed-energy shot is a pale
 * electric bolt that crackles instead of trailing smoke — it deals no damage,
 * so it must not look like a shell. `weaponType` on the projectile entity picks
 * the look — see `spawnProjectile`.
 */
export class ProjectileView {
  readonly container: Container;
  /** Redrawn every tick (missile exhaust / dew discharge); null for a plain tracer. */
  private readonly flicker: Graphics | null = null;
  private readonly kind: 'missile' | 'dew' | 'tracer';

  constructor(projectile: Entity) {
    this.container = new Container();
    this.container.label = `proj:${projectile.id}`;

    const color = ownerColor(projectile.owner);
    const v = projectile.velocity;
    this.container.rotation = v ? Math.atan2(v.y, v.x) : 0;

    if (projectile.weaponType === WeaponType.Missiles) {
      this.kind = 'missile';
      // Rocket body (nose + tail), drawn pointing along +x — container rotation aims it.
      const body = new Graphics();
      body.poly([9, 0, -4, -3.5, -4, 3.5]).fill(color).stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
      this.flicker = new Graphics();
      this.container.addChild(this.flicker, body);
      this.drawFlicker();
    } else if (projectile.weaponType === WeaponType.Dew) {
      this.kind = 'dew';
      // Pale core with a jagged discharge whipping around it, no tracer streak.
      this.flicker = new Graphics();
      const core = new Graphics();
      core
        .circle(0, 0, gameConfig.combat.projectileRadius)
        .fill(palette.status.disabled)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.9 });
      this.container.addChild(this.flicker, core);
      this.drawFlicker();
    } else {
      this.kind = 'tracer';
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
    this.drawFlicker();
  }

  /** Redrawn every tick so the exhaust / discharge never sits still. */
  private drawFlicker(): void {
    if (!this.flicker) return;
    this.flicker.clear();

    if (this.kind === 'missile') {
      const len = 7 + Math.random() * 5;
      this.flicker.poly([-4, -2.5, -4, 2.5, -4 - len, 0]).fill({ color: 0xfbbf24, alpha: 0.6 + Math.random() * 0.3 });
      return;
    }

    // Dew: a short zigzag arc snapping around the core, re-rolled every tick.
    const reach = 5 + Math.random() * 4;
    const jitter = () => (Math.random() - 0.5) * 5;
    this.flicker
      .moveTo(-reach, jitter())
      .lineTo(-reach * 0.3, jitter())
      .lineTo(reach * 0.3, jitter())
      .lineTo(reach, jitter())
      .stroke({ width: 1.5, color: palette.status.disabled, alpha: 0.55 + Math.random() * 0.35 });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
