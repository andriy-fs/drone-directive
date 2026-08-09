import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { useGameStore } from '../../store/gameStore';
import { getDroneTexture } from '../assets';
import { HealthBar } from './HealthBar';
import { ownerColor } from './ownerColor';

/** Bar width (px) and how far above the drone it floats. */
const HP_BAR_WIDTH = 22;
const HP_BAR_OFFSET = 18;

/**
 * View for a side's observer drone: a small diamond marker (so it reads as a
 * flyer, not a ground unit). Lives on the `overlay` layer so it draws above fog
 * and units. `body` rotates with heading; an HP bar appears only once the drone
 * has taken anti-air damage, so an untouched one stays uncluttered.
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

  constructor(drone: Entity) {
    this.container = new Container();
    this.container.label = `drone:${drone.id}`;
    // Visual only: prune from hit-testing so it never swallows clicks meant
    // for robots in the units layer beneath it.
    this.container.eventMode = 'none';

    // undefined = leave the art exactly as authored (the local side's own eye).
    const tint = drone.owner === useGameStore.getState().localSide ? undefined : ownerColor(drone.owner);

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
      if (tint !== undefined) img.tint = tint;
      this.body.addChild(img);
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

    this.update(drone, true);
  }

  update(drone: Entity, visible: boolean): void {
    // The overlay layer draws above the fog, so a drone the local side hasn't
    // detected has to be hidden outright — the fog can't cover it.
    this.container.visible = visible;
    if (drone.position) this.container.position.set(drone.position.x, drone.position.y);
    this.body.rotation = drone.heading ?? 0;

    const maxHp = drone.maxHp ?? 0;
    const hp = drone.hp ?? 0;
    this.hpBar.container.visible = maxHp > 0 && hp < maxHp;
    if (this.hpBar.container.visible) this.hpBar.set(hp / maxHp);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
