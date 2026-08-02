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
  private steppedSinceResume = false;
  private readonly tick = (ticker: Ticker) => this.onTick(ticker);

  constructor(update: UpdateFn, render: RenderFn) {
    this.update = update;
    this.render = render;
  }

  start(ticker: Ticker): void {
    this.ticker = ticker;
    this.steppedSinceResume = false;
    ticker.add(this.tick);
  }

  stop(): void {
    this.ticker?.remove(this.tick);
    this.ticker = null;
    this.accumulator = 0;
  }

  /** Whether the ticker is currently driving the loop (false once `park()`ed). */
  get running(): boolean {
    return this.ticker?.started ?? false;
  }

  /** Restart a parked loop. No-op when it is already running. */
  resume(): void {
    if (!this.ticker || this.ticker.started) return;
    // A resumed ticker starts its clock from now, so nothing of the parked
    // interval carries over — and the guard below has to be re-armed.
    this.steppedSinceResume = false;
    this.ticker.start();
  }

  /**
   * Park the loop until `resume()`, but **only once a fixed step has actually run**
   * since it last resumed — the caller learns from the return value whether it did.
   *
   * Pixi resets the ticker clock inside `Ticker.start()`, so the first frame after
   * a resume reports one frame's delta (~16 ms), which is *less* than `fixedDt`:
   * that frame renders without any `update()` in front of it. Parking on it would
   * put the loop back to sleep before the simulation ever saw whatever one-shot
   * request woke it — the Start button raising `restartRequested` and nothing
   * happening. See `.docs/tasks/menu-start-restart-idle-loop.md`.
   *
   * @returns whether the loop actually parked.
   */
  park(): boolean {
    if (!this.ticker?.started || !this.steppedSinceResume) return false;
    this.ticker.stop();
    return true;
  }

  private onTick(ticker: Ticker): void {
    // Ticker.deltaMS is milliseconds since the previous frame.
    const frameDt = Math.min(ticker.deltaMS / 1000, gameConfig.maxFrameDt);
    this.accumulator += frameDt;

    while (this.accumulator >= gameConfig.fixedDt) {
      this.update(gameConfig.fixedDt);
      this.accumulator -= gameConfig.fixedDt;
      this.steppedSinceResume = true;
    }

    const alpha = this.accumulator / gameConfig.fixedDt;
    this.render(alpha);
  }
}
