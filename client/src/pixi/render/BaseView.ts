import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { useGameStore } from '../../store/gameStore';
import { getBaseTexture } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { HealthBar } from './HealthBar';
import { ownerColor } from './ownerColor';

/**
 * View for a base entity: its faction sprite (or an owner-tinted square + cross
 * placeholder if no art is loaded) and an HP bar above it, positioned at the
 * base's world-space centre. Double-clicking your own base opens the build &
 * program dialog (same one as the HUD button).
 */
export class BaseView {
  readonly container: Container;
  private readonly healthBar: HealthBar;
  private lastClickAt = 0;

  constructor(base: Entity) {
    this.container = new Container();
    this.container.label = `base:${base.id}`;

    const size = (base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx;
    const half = size / 2;

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

    // Only the local side's base is interactive. The enemy base stays
    // pointer-transparent so a right-click on it still reaches the stage handler
    // (→ attack order); otherwise the view would swallow the event.
    if (base.owner === useGameStore.getState().localSide) {
      this.container.eventMode = 'static';
      this.container.cursor = 'pointer';
      // Pin hit-testing to the footprint so the HP bar above it doesn't extend
      // the clickable area over open ground.
      this.container.hitArea = new Rectangle(-half, -half, size, size);
      this.container.on('pointerdown', (e) => {
        if (e.button !== 0) return; // right-click falls through to the stage (move order)
        const now = performance.now();
        if (now - this.lastClickAt < DOUBLE_CLICK_MS) {
          this.lastClickAt = 0; // consume so a third click starts a fresh pair
          e.stopPropagation(); // don't start a marquee underneath the dialog
          useGameStore.getState().setBuildDialogOpen(true);
          return;
        }
        this.lastClickAt = now;
        // A single click deliberately bubbles: box-select and deselect keep
        // working when a drag starts on top of the base.
      });
    }

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
  const color = ownerColor(base.owner);
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
