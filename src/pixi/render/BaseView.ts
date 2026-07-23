import { Container, Graphics, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { Owner } from '../../types/enums';
import { getBaseTexture } from '../assets';
import { HealthBar } from './HealthBar';

/**
 * View for a base entity: its faction sprite (or an owner-tinted square + cross
 * placeholder if no art is loaded), a sight-zone ring for the player's own base,
 * and an HP bar above it, positioned at the base's world-space centre.
 */
export class BaseView {
  readonly container: Container;
  private readonly healthBar: HealthBar;

  constructor(base: Entity) {
    this.container = new Container();
    this.container.label = `base:${base.id}`;

    const size = (base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx;
    const half = size / 2;

    // Vision-zone ring: the base's own detection radius (own side only). Drawn
    // first so it sits under the body.
    if (base.owner === Owner.Player && (base.sightRange ?? 0) > 0) {
      const zone = new Graphics();
      zone
        .circle(0, 0, base.sightRange!)
        .fill({ color: palette.vision.zone, alpha: 0.03 })
        .stroke({ width: 1, color: palette.vision.zone, alpha: 0.35 });
      this.container.addChild(zone);
    }

    const sprite = base.owner ? getBaseTexture(base.owner) : null;
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? size;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      this.container.addChild(img);
    } else {
      this.container.addChild(drawBody(base, size, half));
    }

    this.healthBar = new HealthBar(size);
    this.healthBar.container.position.set(0, -half - 12);

    this.container.addChild(this.healthBar.container);
    if (base.position) this.container.position.set(base.position.x, base.position.y);
    this.update(base, true);
  }

  update(base: Entity, visible: boolean): void {
    this.container.visible = visible;
    this.healthBar.set((base.hp ?? 0) / (base.maxHp ?? 1));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Owner-tinted square + cross placeholder, used when no base sprite is loaded. */
function drawBody(base: Entity, size: number, half: number): Graphics {
  const inset = 4;
  const color = base.owner === Owner.Player ? palette.owner.player : palette.owner.ai;
  const body = new Graphics();
  body
    .rect(-half + inset, -half + inset, size - inset * 2, size - inset * 2)
    .fill({ color, alpha: 0.85 })
    .stroke({ width: 2, color: palette.owner.neutral });
  body
    .moveTo(-half + inset, -half + inset)
    .lineTo(half - inset, half - inset)
    .moveTo(half - inset, -half + inset)
    .lineTo(-half + inset, half - inset)
    .stroke({ width: 1, color: 0x000000, alpha: 0.25 });
  return body;
}
