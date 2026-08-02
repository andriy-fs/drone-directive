import { Container, Graphics } from 'pixi.js';
import { palette } from '../../config/palette';
import type { Vec2 } from '@drone-directive/types/entities';

/** A rally flag and the base it belongs to, in world coordinates. */
export interface RallyMarker {
  base: Vec2;
  rally: Vec2;
}

/** Flagpole height (px) — the flag hangs from its top, the point is at its foot. */
const POLE_HEIGHT = 26;
const FLAG_WIDTH = 14;
const FLAG_HEIGHT = 10;

/**
 * Draws the local side's rally flags: a small flag standing on each rally point,
 * with a faint leader line back to the base that owns it — the line is what
 * makes "the units coming out of there are heading here" readable at a glance.
 *
 * Lives in the `overlay` layer (above fog) and is fed only the local side's
 * markers by `GameApp`: both peers hold the same `production.rally`, so keeping
 * a rally point secret is the renderer's job, not the engine's.
 *
 * Purely presentational — no ECS entity backs it, which keeps a cosmetic object
 * out of the world the desync hash iterates. Redraws only when a marker moves.
 */
export class RallyView {
  readonly container: Container;
  private readonly gfx = new Graphics();
  private lastSignature = '';

  constructor() {
    this.container = new Container();
    this.container.label = 'rally';
    // Visual only: never intercept pointer hit-testing.
    this.container.eventMode = 'none';
    this.container.addChild(this.gfx);
  }

  update(markers: readonly RallyMarker[]): void {
    const signature = markers.map((m) => `${m.base.x},${m.base.y}>${m.rally.x},${m.rally.y}`).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.redraw(markers);
  }

  private redraw(markers: readonly RallyMarker[]): void {
    const g = this.gfx;
    g.clear();
    if (markers.length === 0) return;

    for (const { base, rally } of markers) {
      g.moveTo(base.x, base.y).lineTo(rally.x, rally.y);
    }
    g.stroke({ width: 1, color: palette.selection.rally, alpha: 0.35 });

    for (const { rally } of markers) {
      const top = rally.y - POLE_HEIGHT;
      g.moveTo(rally.x, rally.y).lineTo(rally.x, top);
      g.circle(rally.x, rally.y, 2);
      g.rect(rally.x, top, FLAG_WIDTH, FLAG_HEIGHT);
    }
    g.fill({ color: palette.selection.rally, alpha: 0.75 });
    g.stroke({ width: 2, color: palette.selection.rally });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
