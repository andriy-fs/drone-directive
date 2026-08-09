import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Entity } from '../../engine/ecs/entity';
import { ownerColor } from './ownerColor';

/** How long (ms) the white snap of an absorbed round stays up. */
const FLASH_MS = 120;

/**
 * A base's one-shot energy dome, while it stands.
 *
 * Created and destroyed by the `world.with('base', 'position', 'shield')`
 * reactive query, so its whole lifecycle is the component's — including a base
 * reaped while its dome is up.
 *
 * Three things have to be legible at once and each gets its own mark: that the
 * dome is *there* (a pulsing ring in the owner's colour), how much of it is
 * *left* (a depletion arc, which is what makes a 1000 hp pool readable without a
 * number), and that it is *being hit right now* (a white snap). The last one is
 * inferred here by watching hp fall, rather than from an event or an entity —
 * absorbed rounds are far too frequent to put a mark in the simulation for, and
 * anything in the world would land in `worldHash`.
 */
export class ShieldDomeView {
  readonly container: Container;
  private readonly gfx = new Graphics();
  private lastHp = -1;
  private flashUntil = 0;

  constructor(base: Entity) {
    this.container = new Container();
    this.container.label = `dome:${base.id}`;
    // Visual only: the base underneath must stay clickable through it.
    this.container.eventMode = 'none';
    if (base.position) this.container.position.set(base.position.x, base.position.y);
    this.container.addChild(this.gfx);
  }

  update(base: Entity, visible: boolean, now: number): void {
    this.container.visible = visible;
    const shield = base.shield;
    if (!visible || !shield) return;

    if (shield.hp < this.lastHp) this.flashUntil = now + FLASH_MS;
    this.lastHp = shield.hp;

    const radius = gameConfig.bases.shield.radius;
    const left = Math.max(0, Math.min(1, shield.hp / gameConfig.bases.shield.hp));
    const phase = (now / 1000 / gameConfig.fx.hoverPulsePeriod) * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const color = ownerColor(base.owner);

    const g = this.gfx;
    g.clear();

    // Faint fill: enough to tint the base and the fight under it, never enough
    // to hide either.
    g.circle(0, 0, radius).fill({ color: palette.shield.glow, alpha: 0.06 + 0.04 * pulse });
    g.circle(0, 0, radius).stroke({ width: 2, color, alpha: 0.35 + 0.25 * pulse });

    // Depletion arc, clockwise from twelve o'clock: the dome visibly thins as it
    // is chewed through.
    if (left > 0) {
      const start = -Math.PI / 2;
      g.arc(0, 0, radius - 3, start, start + Math.PI * 2 * left).stroke({
        width: 3,
        color: palette.shield.glow,
        alpha: 0.75,
      });
    }

    if (now < this.flashUntil) {
      g.circle(0, 0, radius).stroke({ width: 3, color: palette.shield.hit, alpha: 0.7 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
