import { gameConfig } from '../../config/gameConfig';
import { perfFlags } from './perfFlags';

/**
 * The frame-time readout behind `?perf=1` — see `perfFlags.ts`. A DOM overlay, not
 * a Pixi object, so it cannot itself show up in the numbers it reports.
 *
 * Reports the **p95** frame time alongside the mean, because that is where a
 * stutter lives: panning that hitches every few frames can hold a respectable
 * average while feeling broken, and the average is exactly the statistic that
 * hides it. `worst` is kept since the last reset for the same reason.
 *
 * Fed from `Ticker.deltaMS`, the interval between frames, so it measures the
 * whole cost — our render pass, Pixi's draw submission and the browser's
 * compositing — rather than only the part of the frame this codebase runs.
 *
 * **It reports the conditions, not just the number.** The first round of readings
 * turned out to have been taken while the match was paused, which silently made
 * one of the switches untestable — a paused sim never bumps `fog.version`, so the
 * fog redraw those frames were supposed to measure had already stopped happening.
 * Nothing on screen said so. A run's numbers are worthless without the state they
 * were taken in, so the state is now on screen next to them and lands in the
 * screenshot automatically.
 */
/**
 * Frames to discard after a reset. Match start pays for texture uploads, the first
 * build of every static Graphics and the initial fog fill — a one-off cost that has
 * nothing to do with how the field pans, and which otherwise owns `worst` for the
 * rest of the run.
 */
const WARMUP_FRAMES = 90;

/** The state a run was taken in, reported alongside its numbers. */
export interface HudConditions {
  inMatch: boolean;
  paused: boolean;
  robots: number;
  /**
   * Share of recent frames a networked match spent waiting on the peer's input,
   * or `null` when the match is not networked. A lockstep stall costs no frame
   * time — the loop renders straight through it — so it cannot show up in the
   * timings, and without it a slow *world* and a slow *frame* read the same.
   */
  stalled: number | null;
}

/**
 * Where a frame's time went. The total interval alone cannot answer "is this the
 * simulation or the drawing?", which is the first question whenever turning the
 * graphics quality down fails to move the frame rate — as it did for the online
 * slowdown these two fields were added for.
 */
export interface FrameCost {
  /** Milliseconds inside the fixed-step update loop, this frame. */
  sim: number;
  /**
   * Milliseconds inside **our** render pass — the previous frame's; see `GameLoop`.
   *
   * This is the scene-graph sync only. Pixi adds its own draw at a lower ticker
   * priority than `GameLoop`, so submission and the browser's compositing land
   * *after* this measurement and are not in it. That gap is deliberate and worth
   * reading: when `mean` is far above `sim + render`, the missing time was spent
   * somewhere this codebase never held the thread — Pixi's draw, the compositor,
   * or another process on the machine.
   */
  render: number;
  /**
   * Milliseconds the main thread was busy across the whole frame, Pixi's draw
   * included — the previous frame's, for the same reason as `render`.
   *
   * This is the number that closes the gap the other two leave open. Compared
   * against the frame interval it says whether a slow frame was *worked* or
   * *waited*: `busy` near the interval means the thread is saturated and there is
   * real work to find; `busy` far below it means the thread sat idle and the
   * frame rate is being set by something this process does not control.
   */
  busy: number;
  /**
   * What the renderer is actually drawing at, which is the live half of the
   * graphics-quality setting (`quality.ts` caps it at 1 on `low`). Reported
   * instead of `devicePixelRatio` because that is the *display's* figure and
   * never moves — a readout showing it cannot say whether the setting took, which
   * is exactly what a run comparing quality levels needs to know.
   */
  resolution: number;
  /**
   * Fixed steps the sim ran this frame (`GameLoop.steps`). Averaged into a
   * ticks-per-second figure, which is the one number that says whether the
   * *world* is running at full speed. `net stall %` cannot: a stalled step keeps
   * its budget now and is caught up in a burst, so a client can stall on half
   * its attempts and still simulate a full 30 ticks/s — or look identical while
   * genuinely starved. Frame timings cannot tell those apart either.
   */
  steps: number;
}

export class PerfHud {
  private readonly el: HTMLDivElement;
  private readonly samples: number[] = [];
  private readonly simSamples: number[] = [];
  private readonly renderSamples: number[] = [];
  private readonly busySamples: number[] = [];
  private readonly stepSamples: number[] = [];
  private worst = 0;
  private worstSim = 0;
  private resolution = 1;
  private lastPaint = 0;
  private warmup = WARMUP_FRAMES;
  private conditions: HudConditions = { inMatch: false, paused: false, robots: 0, stalled: null };

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute',
      'top:8px',
      'left:8px',
      'z-index:9999',
      'padding:6px 9px',
      'font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#d7e2f0',
      'background:rgba(8,12,20,.82)',
      'border:1px solid rgba(125,142,168,.45)',
      'border-radius:5px',
      'white-space:pre',
      'pointer-events:none',
      'user-select:none',
    ].join(';');
    host.appendChild(this.el);
    this.el.textContent = 'measuring…';
  }

  /** Call once per rendered frame with `Ticker.deltaMS`, the frame's cost split, and the state it was rendered in. */
  sample(deltaMs: number, cost: FrameCost, conditions: HudConditions): void {
    // Entering or leaving a match changes what is on screen completely; carrying
    // samples across that boundary would average two different scenes together.
    if (conditions.inMatch !== this.conditions.inMatch) this.reset();
    this.conditions = conditions;

    // A tab that was backgrounded, or the very first frame after the loop is
    // resumed, reports a huge delta that is not a stutter. It would dominate both
    // the p95 and `worst` for the rest of the session.
    if (deltaMs > 500) return;
    if (this.warmup > 0) {
      this.warmup--;
      this.paintWaiting();
      return;
    }
    this.samples.push(deltaMs);
    this.simSamples.push(cost.sim);
    this.renderSamples.push(cost.render);
    this.busySamples.push(cost.busy);
    this.stepSamples.push(cost.steps);
    this.resolution = cost.resolution;
    if (deltaMs > this.worst) this.worst = deltaMs;
    if (cost.sim > this.worstSim) this.worstSim = cost.sim;
    if (this.samples.length > 240) this.samples.shift();
    if (this.simSamples.length > 240) this.simSamples.shift();
    if (this.renderSamples.length > 240) this.renderSamples.shift();
    if (this.busySamples.length > 240) this.busySamples.shift();
    if (this.stepSamples.length > 240) this.stepSamples.shift();

    const now = performance.now();
    if (now - this.lastPaint < 250) return;
    this.lastPaint = now;
    this.paint();
  }

  /** Starts a clean window, discarding the warm-up frames again. */
  reset(): void {
    this.samples.length = 0;
    this.simSamples.length = 0;
    this.renderSamples.length = 0;
    this.busySamples.length = 0;
    this.stepSamples.length = 0;
    this.worst = 0;
    this.worstSim = 0;
    this.warmup = WARMUP_FRAMES;
  }

  private paintWaiting(): void {
    const now = performance.now();
    if (now - this.lastPaint < 250) return;
    this.lastPaint = now;
    this.el.textContent = [this.conditions.inMatch ? `warm-up ${this.warmup}` : 'no match', this.conditionLine()].join(
      '\n',
    );
  }

  /**
   * The line that makes a screenshot self-describing. Map size and robot count
   * because both change what is drawn; paused because a paused sim silently
   * disables the fog redraw and anything else driven by simulation state.
   */
  private conditionLine(): string {
    const { paused, robots, stalled } = this.conditions;
    const n = gameConfig.grid.width;
    const net = stalled === null ? 'solo' : `net stall ${(stalled * 100).toFixed(0)}%`;
    // `res` is what the renderer draws at; `dpr` what the display asks for. They
    // differ exactly when the quality setting is capping the resolution, which is
    // the one thing a quality-comparison run has to be able to see.
    return (
      `${n}x${n}  ${robots} bots  ${paused ? 'PAUSED' : 'running'}  ` +
      `res ${this.resolution}/dpr ${window.devicePixelRatio}  ${net}`
    );
  }

  /** Fixed steps per wall-clock second across the sample window. */
  private tickRate(): number {
    const elapsedMs = this.samples.reduce((a, b) => a + b, 0);
    if (elapsedMs === 0) return 0;
    return (this.stepSamples.reduce((a, b) => a + b, 0) / elapsedMs) * 1000;
  }

  private paint(): void {
    if (!this.samples.length) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const lines = [
      `${(1000 / mean).toFixed(0).padStart(3)} fps   mean ${mean.toFixed(1)}ms`,
      `p95 ${p95.toFixed(1)}ms   worst ${this.worst.toFixed(1)}ms   n=${this.samples.length}`,
      // The line that says which half to go and look at. Anything the two do not
      // account for is time this codebase never had the thread for — the browser's
      // own compositing, another tab, or another process on the machine.
      // `tick` is the world's actual speed over the window. 30/s means the sim is
      // keeping up regardless of what `net stall %` says (a stalled step keeps
      // its budget and is caught up in a burst); anything well below 30/s means
      // the world itself is in slow motion, which no frame timing can show.
      `sim ${average(this.simSamples).toFixed(1)}ms (peak ${this.worstSim.toFixed(1)})   ` +
        `render ${average(this.renderSamples).toFixed(1)}ms   tick ${this.tickRate().toFixed(1)}/s`,
      // `busy` against `mean` on the first line is the whole diagnosis: worked or
      // waited. `idle` spells out the difference so it needs no arithmetic.
      `busy ${average(this.busySamples).toFixed(1)}ms   idle ${Math.max(0, mean - average(this.busySamples)).toFixed(1)}ms`,
      this.conditionLine(),
      perfFlags.overrides.length ? perfFlags.overrides.join(' ') : 'baseline (no flags)',
    ];
    this.el.textContent = lines.join('\n');
  }

  destroy(): void {
    this.el.remove();
  }
}

function average(xs: readonly number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
