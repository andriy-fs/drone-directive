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
}

export class PerfHud {
  private readonly el: HTMLDivElement;
  private readonly samples: number[] = [];
  private worst = 0;
  private lastPaint = 0;
  private warmup = WARMUP_FRAMES;
  private conditions: HudConditions = { inMatch: false, paused: false, robots: 0 };

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

  /** Call once per rendered frame with `Ticker.deltaMS` and the state it was rendered in. */
  sample(deltaMs: number, conditions: HudConditions): void {
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
    if (deltaMs > this.worst) this.worst = deltaMs;
    if (this.samples.length > 240) this.samples.shift();

    const now = performance.now();
    if (now - this.lastPaint < 250) return;
    this.lastPaint = now;
    this.paint();
  }

  /** Starts a clean window, discarding the warm-up frames again. */
  reset(): void {
    this.samples.length = 0;
    this.worst = 0;
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
    const { paused, robots } = this.conditions;
    const n = gameConfig.grid.width;
    return `${n}x${n}  ${robots} bots  ${paused ? 'PAUSED' : 'running'}  dpr ${window.devicePixelRatio}`;
  }

  private paint(): void {
    if (!this.samples.length) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const lines = [
      `${(1000 / mean).toFixed(0).padStart(3)} fps   mean ${mean.toFixed(1)}ms`,
      `p95 ${p95.toFixed(1)}ms   worst ${this.worst.toFixed(1)}ms   n=${this.samples.length}`,
      this.conditionLine(),
      perfFlags.overrides.length ? perfFlags.overrides.join(' ') : 'baseline (no flags)',
    ];
    this.el.textContent = lines.join('\n');
  }

  destroy(): void {
    this.el.remove();
  }
}
