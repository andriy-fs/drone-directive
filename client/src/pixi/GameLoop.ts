import type { Ticker } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';

/**
 * A fixed-timestep simulation update. `dt` is always `gameConfig.fixedDt`.
 * Returns whether the step was consumed. `false` means the world could not
 * advance — a lockstep stall waiting on peer input — and the budget must be
 * kept, so the arrived input can be caught up in a burst. Every other early
 * exit (menu, held start, pause) still consumes its step and returns `true`.
 */
export type UpdateFn = (dt: number) => boolean;
/**
 * A render pass. `alpha` in [0, 1] is the interpolation factor between steps —
 * exactly 1 only while a lockstep stall holds a full step's budget in reserve.
 */
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
  private lastSimMs = 0;
  private lastRenderMs = 0;
  private lastSteps = 0;
  private lastFrameStart = 0;
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

  /**
   * How the last frame's cost split — the two halves of `onTick`, in milliseconds,
   * plus how many fixed steps the sim actually ran. Read by `PerfHud` (via
   * `GameApp.render`), which is the only reason they are measured.
   *
   * `renderMs` is necessarily the **previous** frame's: the HUD is painted from
   * inside `render`, so this frame's figure does not exist yet when it is read.
   * `simMs` is this frame's, since the update loop has already finished by then.
   *
   * A total frame interval on its own cannot say whether a slow frame was spent
   * simulating or drawing, and that distinction is the whole question whenever the
   * graphics-quality setting fails to move the number.
   */
  get simMs(): number {
    return this.lastSimMs;
  }
  get renderMs(): number {
    return this.lastRenderMs;
  }
  /** Fixed steps run in the last frame — 0 when the accumulator had not filled yet. */
  get steps(): number {
    return this.lastSteps;
  }

  /**
   * `performance.now()` at the top of the current frame's tick.
   *
   * Exposed so a listener added *after* Pixi's own draw can subtract it and get
   * the frame's total main-thread occupancy — the one number that separates "the
   * thread is saturated" from "the thread is idle and the browser is simply not
   * handing out frames". Neither `simMs` nor `renderMs` can distinguish those,
   * because all of Pixi's draw submission falls outside both.
   */
  get frameStartedAt(): number {
    return this.lastFrameStart;
  }

  private onTick(ticker: Ticker): void {
    this.lastFrameStart = performance.now();
    // Ticker.deltaMS is milliseconds since the previous frame. The accumulator
    // is capped as a whole, not just per frame: a stalled step below breaks out
    // *without* draining it, so across a long stall it would otherwise grow
    // unboundedly and the recovery frame would try to run hundreds of ticks.
    const frameDt = Math.min(ticker.deltaMS / 1000, gameConfig.maxFrameDt);
    this.accumulator = Math.min(this.accumulator + frameDt, gameConfig.maxFrameDt);

    const simStart = performance.now();
    let steps = 0;
    while (this.accumulator >= gameConfig.fixedDt) {
      // A stalled step (lockstep waiting on peer input) keeps its budget: the
      // world did not advance, so the time is not spent. When the peer's input
      // arrives in a batch, the retained budget catches those ticks up in one
      // frame instead of losing them for good.
      if (!this.update(gameConfig.fixedDt)) break;
      this.accumulator -= gameConfig.fixedDt;
      this.steppedSinceResume = true;
      steps++;
    }
    this.lastSimMs = performance.now() - simStart;
    this.lastSteps = steps;

    // Clamped: after a stall the accumulator legitimately holds >= fixedDt.
    const alpha = Math.min(this.accumulator / gameConfig.fixedDt, 1);
    const renderStart = performance.now();
    this.render(alpha);
    this.lastRenderMs = performance.now() - renderStart;
  }
}
