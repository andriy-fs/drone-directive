import { Container, Point } from 'pixi.js';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { clamp } from '../utils/math';

/**
 * A pannable/zoomable window onto world space. The camera owns a Container that
 * all world layers live inside; moving the camera repositions that Container so
 * the desired world region maps onto the screen. `x`/`y` are the world-space
 * coordinates shown at the top-left of the viewport.
 */
export class Camera {
  /** Container added to the stage; hosts every world layer. */
  readonly view: Container;

  private x = 0;
  private y = 0;
  private zoom = 1;
  private viewportW = 0;
  private viewportH = 0;

  constructor(worldRoot: Container) {
    this.view = new Container();
    this.view.label = 'camera';
    this.view.addChild(worldRoot);
    this.apply();
  }

  /** Called on init and whenever the canvas is resized. */
  setViewport(width: number, height: number): void {
    this.viewportW = width;
    this.viewportH = height;
    this.clampPosition();
    this.apply();
  }

  /** Pan by a delta expressed in screen pixels (e.g. from a pointer drag). */
  panByScreen(dxScreen: number, dyScreen: number): void {
    this.x -= (dxScreen * gameConfig.camera.dragSpeed) / this.zoom;
    this.y -= (dyScreen * gameConfig.camera.dragSpeed) / this.zoom;
    this.clampPosition();
    this.apply();
  }

  /** Pan by a delta expressed in world units (e.g. from keyboard, scaled by dt). */
  panByWorld(dxWorld: number, dyWorld: number): void {
    this.x += dxWorld;
    this.y += dyWorld;
    this.clampPosition();
    this.apply();
  }

  /** Centre the viewport on a world-space point (clamped to the map bounds). */
  centerOn(worldX: number, worldY: number): void {
    this.x = worldX - this.viewportW / this.zoom / 2;
    this.y = worldY - this.viewportH / this.zoom / 2;
    this.clampPosition();
    this.apply();
  }

  /**
   * Multiply the zoom by `factor`, keeping the world point under the anchor (a
   * screen-space position, e.g. the cursor or the midpoint of a pinch) pinned
   * where it is. Clamped to the configured range; a no-op once there.
   */
  zoomAt(factor: number, anchorScreenX: number, anchorScreenY: number): void {
    const { minZoom, maxZoom } = gameConfig.camera;
    const next = clamp(this.zoom * factor, minZoom, maxZoom);
    // Already against the stop: skip the transform rather than re-applying the
    // same one every notch the player keeps scrolling.
    if (next === this.zoom) return;

    this.x += anchorShift(anchorScreenX, this.zoom, next);
    this.y += anchorShift(anchorScreenY, this.zoom, next);
    this.zoom = next;
    this.clampPosition();
    this.apply();
  }

  /** Back to 1:1 — the scale a new match starts at. */
  resetZoom(): void {
    if (this.zoom === 1) return;
    this.zoom = 1;
    this.clampPosition();
    this.apply();
  }

  /** Convert a screen-space (global) point to world coordinates. */
  screenToWorld(globalX: number, globalY: number): Vec2 {
    const p = this.view.toLocal(new Point(globalX, globalY));
    return { x: p.x, y: p.y };
  }

  private clampPosition(): void {
    this.x = clampAxis(this.x, this.viewportW / this.zoom, worldPixelSize.width);
    this.y = clampAxis(this.y, this.viewportH / this.zoom, worldPixelSize.height);
  }

  private apply(): void {
    this.view.scale.set(this.zoom);
    this.view.position.set(-this.x * this.zoom, -this.y * this.zoom);
  }
}

/**
 * How far the viewport origin has to move so the world point currently under
 * `anchor` (screen pixels) stays under it across a zoom change.
 *
 * `apply` puts screen at `(world - origin) * zoom`, so `world = origin + screen / zoom`.
 * Holding that world point fixed across the change and solving for the new
 * origin leaves exactly the difference below.
 */
export function anchorShift(anchor: number, from: number, to: number): number {
  return anchor / from - anchor / to;
}

/**
 * Keep one axis inside the map. Zoomed far enough out the visible span can be
 * *wider* than the world — on the small map that happens well before `minZoom` —
 * and clamping to 0 there would shove the whole field into the top-left corner
 * with every empty pixel piled on the other two sides. Centre the span instead;
 * a negative origin is what centring means here.
 */
export function clampAxis(origin: number, visible: number, worldSpan: number): number {
  if (visible >= worldSpan) return (worldSpan - visible) / 2;
  return clamp(origin, 0, worldSpan - visible);
}
