import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { useGameStore } from '../../store/gameStore';
import { getBaseTexture } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { HealthBar } from './HealthBar';
import { ownerColor, teamTint } from './ownerColor';

/**
 * View for a base entity: its faction sprite (or an owner-tinted square + cross
 * placeholder if no art is loaded), the built-in missile battery's launcher, an
 * HP bar above it and a selection outline, positioned at the base's world-space
 * centre. Double-clicking your own base opens the build & program dialog (same
 * one as the HUD button); selecting it is handled by the stage handler in
 * `input/pointer.ts`, not here.
 */
export class BaseView {
  readonly container: Container;
  private readonly healthBar: HealthBar;
  private readonly ring: Graphics;
  private readonly turret: Graphics;
  private lastClickAt = 0;

  constructor(base: Entity) {
    this.container = new Container();
    this.container.label = `base:${base.id}`;

    const size = (base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx;
    const half = size / 2;

    // Selection outline, under the body — same colour as a robot's ring.
    this.ring = new Graphics();
    this.ring
      .rect(-half - 3, -half - 3, size + 6, size + 6)
      .stroke({ width: 2, color: palette.selection.ring });
    this.ring.visible = false;
    this.container.addChild(this.ring);

    const sprite = base.owner ? getBaseTexture(base.owner) : null;
    if (sprite) {
      const { texture, def } = sprite;
      const target = def.targetSize ?? size;
      const dim = Math.max(texture.width, texture.height) || target;
      const img = new Sprite(texture);
      img.anchor.set(0.5);
      img.scale.set(target / dim);
      const tint = teamTint(base.owner);
      if (tint !== undefined) img.tint = tint;
      this.container.addChild(img);
    } else {
      this.container.addChild(drawBody(base, size, half));
    }

    // The launcher, above the body: the only thing on screen that says *where*
    // the base's fire is coming from. A shot with no visible source reads as a
    // bug, so the barrel tracks the current target every tick.
    this.turret = drawTurret();
    this.container.addChild(this.turret);

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

    this.update(base, true, false);
  }

  update(base: Entity, visible: boolean, selected: boolean): void {
    this.container.visible = visible;
    this.ring.visible = selected;
    this.turret.rotation = base.heading ?? 0;
    this.healthBar.set((base.hp ?? 0) / (base.maxHp ?? 1));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * The missile battery's launcher: a turntable with a twin barrel pointing along
 * +x, so `rotation = heading` (the `atan2` the resolver stores) aims it. Small
 * on purpose — it marks the base's one weapon without competing with the art.
 */
function drawTurret(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 7).fill({ color: palette.turret.body }).stroke({ width: 1.5, color: palette.turret.edge });
  g.rect(2, -4, 14, 2.5).rect(2, 1.5, 14, 2.5).fill({ color: palette.turret.edge });
  return g;
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
