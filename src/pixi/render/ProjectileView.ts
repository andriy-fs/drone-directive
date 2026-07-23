import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { Owner } from '../../types/enums';

/** Placeholder view for a projectile: a small owner-tinted dot. */
export class ProjectileView {
  readonly container: Container;

  constructor(projectile: Entity) {
    this.container = new Container();
    this.container.label = `proj:${projectile.id}`;

    const color = projectile.owner === Owner.Player ? palette.owner.player : palette.owner.ai;
    const dot = new Graphics();
    dot
      .circle(0, 0, gameConfig.combat.projectileRadius)
      .fill(color)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.85 });

    this.container.addChild(dot);
    this.update(projectile);
  }

  update(projectile: Entity): void {
    if (projectile.position) this.container.position.set(projectile.position.x, projectile.position.y);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
