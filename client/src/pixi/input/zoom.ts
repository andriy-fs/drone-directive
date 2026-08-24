import { Point, type Application } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { GameStatus } from '../../store/enums';
import { useGameStore } from '../../store/gameStore';
import type { Camera } from '../Camera';

/**
 * Zoom input, kept out of `pointer.ts` because it shares none of its state: the
 * wheel never selects anything, and a pinch is the one gesture that has to *undo*
 * a selection the other file already started.
 *
 * - Wheel = zoom towards/away from the cursor.
 * - Trackpad pinch = the same, and the browser hands it over as a `wheel` event
 *   with `ctrlKey` set (which is also why the default has to be prevented: left
 *   alone the page would take it as a browser zoom).
 * - Touchscreen pinch = two pointers, tracked here.
 */

/** `WheelEvent.deltaMode` is one of three units; both non-pixel ones are normalised to pixels. */
const LINE_HEIGHT_PX = 16;
const PAGE_HEIGHT_PX = 800;
/** Pixels one detent of a mouse wheel reports (what Chrome sends for a click-stop). */
const NOTCH_PX = 100;

export interface ZoomHooks {
  /**
   * A second finger landed: whatever the first one started (a selection marquee,
   * over in `pointer.ts`) was the beginning of a pinch, not a drag.
   */
  onPinchStart: () => void;
}

/**
 * The multiplier one wheel event should apply to the current zoom. Pure, so the
 * unit normalisation and the direction can be tested without a renderer.
 *
 * Fractional notches are deliberate: a trackpad's two-finger scroll arrives as a
 * stream of small deltas, and rounding each one up to a full step would make the
 * gesture leap. Both branches are exponential in the delta, which is what makes
 * the gesture symmetric — scrolling back the same distance lands on the zoom you
 * started from.
 */
export function zoomFactorFromWheel(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const px = deltaY * (deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1);
  // A pinch is continuous, so it gets a per-pixel rate; a wheel is discrete and
  // gets the configured step per notch. Negative delta (scroll up / spread the
  // fingers) has to zoom *in*, hence the minus in both exponents.
  if (ctrlKey) return Math.exp(-px * gameConfig.camera.pinchZoomSensitivity);
  return gameConfig.camera.wheelZoomStep ** (-px / NOTCH_PX);
}

/** The multiplier a pinch's change in finger distance should apply. Pure. */
export function pinchFactor(prevDistance: number, nextDistance: number): number {
  if (prevDistance <= 0 || !Number.isFinite(prevDistance) || !Number.isFinite(nextDistance)) return 1;
  return nextDistance / prevDistance;
}

/** Wires wheel + pinch to the camera. Returns the teardown. */
export function attachZoomControls(app: Application, camera: Camera, hooks: ZoomHooks): () => void {
  // One scratch point for the whole session: `mapPositionToPoint` writes into it,
  // and these handlers fire often enough that allocating per event is waste.
  const anchor = new Point();
  const isPlaying = () => useGameStore.getState().status === GameStatus.Playing;

  /** Client (CSS pixel) coordinates to the screen space the camera speaks. */
  const toScreen = (clientX: number, clientY: number): Point => {
    app.renderer.events.mapPositionToPoint(anchor, clientX, clientY);
    return anchor;
  };

  const onWheel = (e: WheelEvent) => {
    // Prevented even outside a match: over the canvas the page must never scroll
    // and Ctrl+wheel must never reach the browser's own zoom.
    e.preventDefault();
    if (!isPlaying()) return;
    const factor = zoomFactorFromWheel(e.deltaY, e.deltaMode, e.ctrlKey);
    if (factor === 1) return;
    const p = toScreen(e.clientX, e.clientY);
    camera.zoomAt(factor, p.x, p.y);
  };

  // Touchscreen pinch. Only touch pointers are tracked: a mouse never has a
  // second contact, and counting it would let a pen drag pass for a gesture.
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const twoTouches = (): [{ x: number; y: number }, { x: number; y: number }] | null => {
    if (touches.size !== 2) return null;
    const [a, b] = [...touches.values()];
    return [a, b];
  };

  const distanceOf = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot(b.x - a.x, b.y - a.y);

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !isPlaying()) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pair = twoTouches();
    if (!pair) return;
    pinchDistance = distanceOf(pair[0], pair[1]);
    // The first finger already opened a marquee; this one says it was a pinch.
    hooks.onPinchStart();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pair = twoTouches();
    if (!pair) return;
    const next = distanceOf(pair[0], pair[1]);
    const factor = pinchFactor(pinchDistance, next);
    pinchDistance = next;
    if (factor === 1) return;
    const p = toScreen((pair[0].x + pair[1].x) / 2, (pair[0].y + pair[1].y) / 2);
    camera.zoomAt(factor, p.x, p.y);
  };

  const onPointerEnd = (e: PointerEvent) => {
    if (!touches.delete(e.pointerId)) return;
    // A pinch that loses a finger is over: the distance it left behind must not
    // be measured against whatever the next gesture starts at.
    if (touches.size < 2) pinchDistance = 0;
  };

  const canvas = app.canvas;
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerEnd);
  canvas.addEventListener('pointerleave', onPointerEnd);

  return () => {
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerEnd);
    canvas.removeEventListener('pointercancel', onPointerEnd);
    canvas.removeEventListener('pointerleave', onPointerEnd);
    touches.clear();
  };
}
