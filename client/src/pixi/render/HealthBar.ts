import { Container, Graphics } from 'pixi.js';

/**
 * A reusable HP bar drawn in world space (used by bases now, robots in Phase 3).
 * Origin is the horizontal centre / vertical top of the bar. Redraws only when
 * the ratio actually changes to avoid per-frame Graphics churn.
 */
export class HealthBar {
  readonly container: Container;
  private readonly fill: Graphics;
  private readonly barWidth: number;
  private readonly barHeight: number;
  private lastRatio = -1;

  constructor(width: number, height = 6) {
    this.barWidth = width;
    this.barHeight = height;
    this.container = new Container();

    const bg = new Graphics();
    bg.rect(-width / 2, 0, width, height).fill({ color: 0x000000, alpha: 0.6 });

    this.fill = new Graphics();
    this.container.addChild(bg, this.fill);
  }

  /** Set the filled fraction, 0..1. */
  set(ratio: number): void {
    const r = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    if (r === this.lastRatio) return;
    this.lastRatio = r;

    const color = r > 0.5 ? 0x22c55e : r > 0.25 ? 0xf59e0b : 0xef4444;
    this.fill.clear();
    if (r > 0) {
      this.fill.rect(-this.barWidth / 2, 0, this.barWidth * r, this.barHeight).fill(color);
    }
  }
}
