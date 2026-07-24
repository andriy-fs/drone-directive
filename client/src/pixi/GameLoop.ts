import type { Ticker } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';

/** A fixed-timestep simulation update. `dt` is always `gameConfig.fixedDt`. */
export type UpdateFn = (dt: number) => void;
/** A render pass. `alpha` in [0, 1) is the interpolation factor between steps. */
export type RenderFn = (alpha: number) => void;

/**
 * Fixed-timestep game loop, decoupled from the render frame rate. The simulation
 * advances in constant `fixedDt` increments (so combat/AI are deterministic and
 * frame-rate independent) while rendering happens once per animation frame with
 * an interpolation factor. Driven by Pixi's Ticker.
 *
 * Phase 1 has no entities yet, so `update`/`render` are lightweight, but the
 * accumulator machinery is in place for later phases.
 */
export class GameLoop {
  private accumulator = 0;
  private readonly update: UpdateFn;
  private readonly render: RenderFn;
  private ticker: Ticker | null = null;
  private readonly tick = (ticker: Ticker) => this.onTick(ticker);

  constructor(update: UpdateFn, render: RenderFn) {
    this.update = update;
    this.render = render;
  }

  start(ticker: Ticker): void {
    this.ticker = ticker;
    ticker.add(this.tick);
  }

  stop(): void {
    this.ticker?.remove(this.tick);
    this.ticker = null;
    this.accumulator = 0;
  }

  private onTick(ticker: Ticker): void {
    // Ticker.deltaMS is milliseconds since the previous frame.
    const frameDt = Math.min(ticker.deltaMS / 1000, gameConfig.maxFrameDt);
    this.accumulator += frameDt;

    while (this.accumulator >= gameConfig.fixedDt) {
      this.update(gameConfig.fixedDt);
      this.accumulator -= gameConfig.fixedDt;
    }

    const alpha = this.accumulator / gameConfig.fixedDt;
    this.render(alpha);
  }
}
