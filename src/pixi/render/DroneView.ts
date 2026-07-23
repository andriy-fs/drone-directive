import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { getDroneTexture } from '../assets';

/**
 * View for the player's observer drone: a small diamond marker (so it reads as a
 * flyer, not a ground unit) plus its sight-radius ring. Lives on the `overlay`
 * layer so it draws above fog and units. `body` rotates with heading.
 */
export class DroneView {
  readonly container: Container;
  private readonly body: Container;

  constructor(drone: Entity) {
    this.container = new Container();
    this.container.label = `drone:${drone.id}`;
    // Visual only: prune from hit-testing so the large sight-zone circle (topmost
    // overlay layer) never swallows clicks meant for robots in the units layer.
    this.container.eventMode = 'none';

    if ((drone.sightRange ?? 0) > 0) {
      const zone = new Graphics();
      zone
        .circle(0, 0, drone.sightRange!)
        .fill({ color: palette.vision.zone, alpha: 0.04 })
        .stroke({ width: 1, color: palette.vision.zone, alpha: 0.4 });
      this.container.addChild(zone);
    }

    this.body = new Container();
    const sprite = getDroneTexture();
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? gameConfig.grid.tilePx * 1.25;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      img.rotation = def.rotationOffset ?? 0;
      this.body.addChild(img);
    } else {
      const r = gameConfig.robots.radius * 0.9;
      const g = new Graphics();
      g.poly([0, -r, r, 0, 0, r, -r, 0])
        .fill({ color: palette.drone.body })
        .stroke({ width: 2, color: palette.drone.edge });
      g.circle(0, 0, 2.5).fill(palette.drone.edge);
      this.body.addChild(g);
    }
    this.container.addChild(this.body);

    this.update(drone);
  }

  update(drone: Entity): void {
    if (drone.position) this.container.position.set(drone.position.x, drone.position.y);
    this.body.rotation = drone.heading ?? 0;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
