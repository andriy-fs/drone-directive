import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FederatedPointerEvent } from 'pixi.js';
import { runAfterTouch } from './afterTouch';

/**
 * A stand-in for `window` with just the two methods the helper uses, so the node
 * environment can watch what it registers and — the part that matters — what it
 * takes back off again.
 */
function stubWindow() {
  const listeners = new Map<string, (e: never) => void>();
  const win = {
    addEventListener: (type: string, fn: (e: never) => void) => listeners.set(type, fn),
    removeEventListener: (type: string, fn: (e: never) => void) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  return { listeners, win };
}

/** A press at `(x, y)` in client px — the only field of the event the helper reads. */
const press = (x: number, y: number) => ({ client: { x, y } }) as FederatedPointerEvent;

/** A lift at `(x, y)`, shaped like the `TouchEvent` the listener is handed. */
const lift = (x: number, y: number) => ({ changedTouches: [{ clientX: x, clientY: y }] }) as unknown as TouchEvent;

describe('runAfterTouch', () => {
  let listeners: Map<string, (e: never) => void>;

  beforeEach(() => {
    const stub = stubWindow();
    listeners = stub.listeners;
    vi.stubGlobal('window', stub.win);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('runs the callback when the finger lifts, not when it goes down', () => {
    const fn = vi.fn();
    runAfterTouch(press(100, 100), fn);
    expect(fn).not.toHaveBeenCalled();

    listeners.get('touchend')?.(lift(102, 103) as never);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('drops it when the press wandered far enough to be a drag', () => {
    const fn = vi.fn();
    runAfterTouch(press(100, 100), fn);
    listeners.get('touchend')?.(lift(140, 100) as never);
    expect(fn).not.toHaveBeenCalled();
  });

  it('drops it on touchcancel — a press the browser took away opens nothing', () => {
    const fn = vi.fn();
    runAfterTouch(press(100, 100), fn);
    listeners.get('touchcancel')?.(undefined as never);
    expect(fn).not.toHaveBeenCalled();
  });

  /** Otherwise a cancelled press would leave a listener to fire on somebody else's tap. */
  it('unregisters both listeners whichever way the press ended', () => {
    runAfterTouch(press(100, 100), vi.fn());
    listeners.get('touchend')?.(lift(100, 100) as never);
    expect(listeners.size).toBe(0);

    runAfterTouch(press(100, 100), vi.fn());
    listeners.get('touchcancel')?.(undefined as never);
    expect(listeners.size).toBe(0);
  });
});
