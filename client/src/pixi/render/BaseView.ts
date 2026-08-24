import { Container, Graphics, Rectangle, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import { BASE_CYCLE_MS } from '../../config/sprites';
import type { BaseEntity } from '../../engine/ecs/archetypes';
import { useGameStore } from '../../store/gameStore';
import { getBaseGaitTextures, getBaseTexture, type ResolvedSprite } from '../assets';
import { DOUBLE_CLICK_MS } from '../input/doubleClick';
import { HealthBar } from './HealthBar';
import { ownerColor, teamTint } from './ownerColor';
import { hashUnit } from './terrain/hash';

/**
 * View for a base entity: its faction sprite (or an owner-tinted square + cross
 * placeholder if no art is loaded), the built-in missile battery's launcher, an
 * HP bar above it and a selection outline, positioned at the base's world-space
 * centre. Double-clicking your own base opens the build & program dialog (same
 * one as the HUD button); selecting it is handled by the stage handler in
 * `input/pointer.ts`, not here.
 *
 * The sprite is a **four-cell idle cycle** where the art exists (`baseGaitSprites`)
 * — running lights, a turning radar dish, chevrons marching out of the production
 * bay, breathing vents — clocked off the frame's wall clock rather than off travel,
 * since a base never moves. Art falls back in two steps: sheet → still sprite →
 * Graphics placeholder.
 */
export class BaseView {
  readonly container: Container;
  private readonly healthBar: HealthBar;
  private readonly ring: Graphics;
  private readonly turret: Graphics;
  /** The idle-cycle cells in cycle order, or null when this base has no sheet. */
  private readonly frames: ResolvedSprite[] | null;
  /** The sprite the cycle swaps textures on; null when the art fell back to Graphics. */
  private readonly img: Sprite | null = null;
  /**
   * Where in the cycle this base starts, in `[0, 1)`. Hashed from its own position so
   * two bases on screen do not blink in lockstep — which would read as one global
   * pulse rather than as each building running its own machinery.
   */
  private readonly phase: number;
  private frame = 0;
  private lastClickAt = 0;

  constructor(base: BaseEntity) {
    this.container = new Container();
    this.container.label = `base:${base.id}`;

    const size = base.footprint * gameConfig.grid.tilePx;
    const half = size / 2;

    // Selection outline, under the body — same colour as a robot's ring.
    this.ring = new Graphics();
    this.ring
      .rect(-half - 3, -half - 3, size + 6, size + 6)
      .stroke({ width: 2, color: palette.selection.ring });
    this.ring.visible = false;
    this.container.addChild(this.ring);

    this.frames = base.owner ? getBaseGaitTextures(base.owner) : null;
    // Cell 0 is the rest pose, so it is also the right thing to show on the first
    // frame — and it is what the still sprite is cut from.
    const sprite = this.frames?.[0] ?? (base.owner ? getBaseTexture(base.owner) : null);
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
      this.img = img;
    } else {
      this.container.addChild(drawBody(base, size, half));
    }

    // Same pure hash the terrain decals are placed by, read off the footprint's
    // tile so it is stable for the life of the match.
    const tile = gameConfig.grid.tilePx;
    this.phase = base.position
      ? hashUnit(Math.round(base.position.x / tile), Math.round(base.position.y / tile), 0x1d)
      : 0;

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

    this.update(base, true, false, performance.now());
  }

  update(base: BaseEntity, visible: boolean, selected: boolean, now: number): void {
    this.container.visible = visible;
    this.ring.visible = selected;
    this.turret.rotation = base.heading;
    this.healthBar.set(base.hp / base.maxHp);

    // Swap only on a cell change: assigning the same texture every frame would ask
    // Pixi to rebind it 60 times a second for nothing (the guard `RobotView` uses).
    if (!this.frames || !this.img) return;
    const frame = cellAt(now, this.phase, this.frames.length);
    if (frame !== this.frame) {
      this.frame = frame;
      this.img.texture = this.frames[frame].texture;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/**
 * Which cell of a `cells`-long cycle `now` (ms) falls in, offset by `phase` turns.
 *
 * Kept apart from `render/gait.ts` deliberately: that clock is driven by distance
 * travelled and its docstring is an argument for why, none of which applies to a
 * building that never moves.
 */
function cellAt(now: number, phase: number, cells: number): number {
  const cycles = now / BASE_CYCLE_MS + phase;
  const frame = Math.floor(cycles * cells) % cells;
  return frame < 0 ? frame + cells : frame;
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
function drawBody(base: BaseEntity, size: number, half: number): Graphics {
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
