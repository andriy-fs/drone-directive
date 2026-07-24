import { Container, Point } from 'pixi.js';
import { gameConfig, worldPixelSize } from '../config/gameConfig';
import type { Vec2 } from '../types/entities';
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

  /** Convert a screen-space (global) point to world coordinates. */
  screenToWorld(globalX: number, globalY: number): Vec2 {
    const p = this.view.toLocal(new Point(globalX, globalY));
    return { x: p.x, y: p.y };
  }

  private clampPosition(): void {
    const maxX = Math.max(0, worldPixelSize.width - this.viewportW / this.zoom);
    const maxY = Math.max(0, worldPixelSize.height - this.viewportH / this.zoom);
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }

  private apply(): void {
    this.view.scale.set(this.zoom);
    this.view.position.set(-this.x * this.zoom, -this.y * this.zoom);
  }
}
