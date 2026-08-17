import { describe, expect, it } from 'vitest';
import type { Ticker } from 'pixi.js';
import { gameConfig } from '../config/gameConfig';
import { GameLoop } from './GameLoop';

/** One 60 Hz animation frame, in ms — shorter than the 30 Hz fixed step. */
const FRAME_MS = 1000 / 60;
const FIXED_MS = gameConfig.fixedDt * 1000;

/**
 * Stand-in for Pixi's Ticker: the loop only ever uses `add`/`remove`/`start`/`stop`
 * and reads `deltaMS`/`started`, and driving frames by hand is what makes the
 * wake/park ordering testable at all.
 */
class FakeTicker {
  started = true;
  deltaMS = 0;
  starts = 0;
  stops = 0;
  private listeners: ((ticker: FakeTicker) => void)[] = [];

  add(fn: (ticker: FakeTicker) => void): void {
    this.listeners.push(fn);
  }

  remove(fn: (ticker: FakeTicker) => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  start(): void {
    this.started = true;
    this.starts += 1;
  }

  stop(): void {
    this.started = false;
    this.stops += 1;
  }

  /** Deliver one animation frame, as the browser would — ignored while stopped. */
  frame(ms = FRAME_MS): void {
    if (!this.started) return;
    this.deltaMS = ms;
    for (const listener of [...this.listeners]) listener(this);
  }

  get asTicker(): Ticker {
    return this as unknown as Ticker;
  }
}

function spyLoop() {
  const steps: number[] = [];
  const renders: number[] = [];
  // `stalled` mimics the lockstep wait: while true, `update` refuses the step
  // and the loop must keep its budget.
  const state = { stalled: false };
  const loop = new GameLoop(
    (dt) => {
      if (state.stalled) return false;
      steps.push(dt);
      return true;
    },
    (alpha) => renders.push(alpha),
  );
  return { loop, steps, renders, state };
}

describe('GameLoop fixed step', () => {
  it('renders every frame but only steps once a full fixed step has accumulated', () => {
    const ticker = new FakeTicker();
    const { loop, steps, renders } = spyLoop();
    loop.start(ticker.asTicker);

    // A single 60 Hz frame is ~16.7 ms against a 33.3 ms step: render, no step.
    ticker.frame();
    expect(steps).toHaveLength(0);
    expect(renders).toHaveLength(1);

    ticker.frame();
    ticker.frame();
    expect(steps).toEqual([gameConfig.fixedDt]);
    expect(renders).toHaveLength(3);
  });

  it('drains several steps from one long frame, clamped so a hidden tab cannot flood the sim', () => {
    const ticker = new FakeTicker();
    const { loop, steps } = spyLoop();
    loop.start(ticker.asTicker);

    ticker.frame(10_000);
    expect(steps).toHaveLength(Math.floor(gameConfig.maxFrameDt / gameConfig.fixedDt));
  });
});

describe('GameLoop lockstep stall', () => {
  it('keeps the budget of a stalled step and catches up once input arrives', () => {
    const ticker = new FakeTicker();
    const { loop, steps, renders, state } = spyLoop();
    loop.start(ticker.asTicker);

    // Three fixed steps' worth of frames, all stalled: the world never advances,
    // but rendering carries on and the budget stays banked.
    state.stalled = true;
    for (let i = 0; i < 3; i++) ticker.frame(FIXED_MS);
    expect(steps).toHaveLength(0);
    expect(renders).toHaveLength(3);

    // The peer's input lands: one ordinary frame drains the whole backlog.
    state.stalled = false;
    ticker.frame(FIXED_MS);
    expect(steps).toHaveLength(4);
  });

  it('caps the banked budget so a long stall cannot flood the recovery frame', () => {
    const ticker = new FakeTicker();
    const { loop, steps, state } = spyLoop();
    loop.start(ticker.asTicker);

    state.stalled = true;
    for (let i = 0; i < 100; i++) ticker.frame(FIXED_MS);
    expect(steps).toHaveLength(0);

    state.stalled = false;
    ticker.frame(FIXED_MS);
    expect(steps.length).toBeLessThanOrEqual(Math.floor(gameConfig.maxFrameDt / gameConfig.fixedDt));
    expect(steps.length).toBeGreaterThan(1); // still a catch-up burst, not a single step
  });

  it('renders with alpha clamped to at most 1 while stalled', () => {
    const ticker = new FakeTicker();
    const { loop, renders, state } = spyLoop();
    loop.start(ticker.asTicker);

    state.stalled = true;
    for (let i = 0; i < 5; i++) ticker.frame(FIXED_MS);
    for (const alpha of renders) expect(alpha).toBeLessThanOrEqual(1);
  });

  it('does not count a stalled step as having run for parking purposes', () => {
    const ticker = new FakeTicker();
    const { loop, state } = spyLoop();
    loop.start(ticker.asTicker);

    state.stalled = true;
    ticker.frame(FIXED_MS);
    expect(loop.park()).toBe(false); // no step was actually consumed

    state.stalled = false;
    ticker.frame(FIXED_MS);
    expect(loop.park()).toBe(true);
  });
});

describe('GameLoop parking', () => {
  it('refuses to park before a step has run since resuming', () => {
    const ticker = new FakeTicker();
    const { loop, steps } = spyLoop();
    loop.start(ticker.asTicker);

    ticker.frame(FIXED_MS);
    expect(loop.park()).toBe(true);
    expect(loop.running).toBe(false);

    loop.resume();
    expect(loop.running).toBe(true);
    const stepsBeforeWake = steps.length;

    // The regression: the first frame after a resume is a bare render (the ticker
    // clock restarts, so less than one fixed step has elapsed). Parking here would
    // strand whatever request woke the loop.
    ticker.frame();
    expect(steps).toHaveLength(stepsBeforeWake);
    expect(loop.park()).toBe(false);
    expect(loop.running).toBe(true);

    // …and it parks again as soon as the simulation has genuinely advanced.
    ticker.frame();
    ticker.frame();
    expect(steps.length).toBeGreaterThan(stepsBeforeWake);
    expect(loop.park()).toBe(true);
    expect(loop.running).toBe(false);
  });

  it('always consumes a one-shot request raised while parked (Start on the title screen)', () => {
    const ticker = new FakeTicker();
    // Mirrors the GameApp bridge: `update` consumes the store's one-shot flag,
    // `render` parks whenever there is no match to simulate.
    const store = { restartRequested: false, matchRunning: false };
    const loop: GameLoop = new GameLoop(
      () => {
        if (store.restartRequested) {
          store.restartRequested = false;
          store.matchRunning = true;
        }
        return true; // never a stall: the menu consumes every step it gets
      },
      () => {
        if (!store.matchRunning) loop.park();
      },
    );
    loop.start(ticker.asTicker);

    // Idle on the menu: the loop parks itself and the tab goes quiet. Whole fixed
    // steps, so it parks with an empty accumulator — exactly the state the title
    // screen sits in, and the one where the next wake-up gets a bare render frame.
    for (let i = 0; i < 4; i++) ticker.frame(FIXED_MS);
    expect(loop.running).toBe(false);
    const framesParked = ticker.stops;

    // Click Start → the store flag flips and the bridge wakes the loop.
    store.restartRequested = true;
    loop.resume();
    for (let i = 0; i < 4; i++) ticker.frame();

    expect(store.restartRequested).toBe(false); // consumed, not swallowed by an early park
    expect(store.matchRunning).toBe(true);
    expect(loop.running).toBe(true);
    expect(ticker.stops).toBe(framesParked);
  });

  it('parks and resumes idempotently, and never resumes a loop that was stopped', () => {
    const ticker = new FakeTicker();
    const { loop } = spyLoop();
    loop.start(ticker.asTicker);
    ticker.frame(FIXED_MS);

    expect(loop.park()).toBe(true);
    expect(loop.park()).toBe(false); // already parked
    expect(ticker.stops).toBe(1);

    loop.resume();
    loop.resume(); // already running
    expect(ticker.starts).toBe(1);

    loop.stop();
    loop.resume();
    expect(loop.running).toBe(false);
  });
});
