import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Vec2 } from '@drone-directive/types/entities';
import { lerp } from '../../utils/math';

/** Which order the marker acknowledges — it only picks the colour. */
export type OrderMarkerKind = 'move' | 'attack';

/** Marker lifetimes are wall-clock, so a burst of clicks cannot grow this without bound. */
const MAX_MARKERS = 8;

/** Radius (px) the collapsing ring ends on, and the size of the dot left at the point. */
const CORE_RADIUS = 4;

interface Marker {
  x: number;
  y: number;
  kind: OrderMarkerKind;
  /** `performance.now()` at the click. */
  start: number;
}

/**
 * Acknowledges a right-click order: a ring collapsing onto the ordered point,
 * green for a move and red for an attack. Spawned by `pointer.ts` only when an
 * order was actually issued, so an empty selection leaves no mark.
 *
 * Purely presentational, like `RallyView` — no ECS entity backs it, which keeps
 * a client-local visual out of the world the desync hash iterates. Timed off
 * `performance.now()` rather than the fixed step for the same reason: it is not
 * simulation state, and it should finish animating even while the match is paused.
 */
export class OrderMarkerView {
  readonly container: Container;
  private readonly gfx = new Graphics();
  private markers: Marker[] = [];
  private drewLastFrame = false;

  constructor() {
    this.container = new Container();
    this.container.label = 'order-markers';
    // Visual only: never intercept pointer hit-testing.
    this.container.eventMode = 'none';
    this.container.addChild(this.gfx);
  }

  /** Drop a marker at a world point. `now` defaults to the current clock. */
  add(point: Vec2, kind: OrderMarkerKind, now = performance.now()): void {
    this.markers.push({ x: point.x, y: point.y, kind, start: now });
    if (this.markers.length > MAX_MARKERS) this.markers.shift();
  }

  update(now: number): void {
    const duration = gameConfig.fx.orderMarkerDuration * 1000;
    this.markers = this.markers.filter((m) => now - m.start < duration);

    if (this.markers.length === 0) {
      // Nothing live: clear once, then leave the Graphics alone for the rest of
      // the match — an idle world must not pay for this every frame.
      if (this.drewLastFrame) {
        this.gfx.clear();
        this.drewLastFrame = false;
      }
      return;
    }

    const g = this.gfx;
    g.clear();
    this.drewLastFrame = true;

    for (const m of this.markers) {
      const t = (now - m.start) / duration;
      const alpha = 1 - t;
      const color = palette.order[m.kind];
      g.circle(m.x, m.y, lerp(gameConfig.fx.orderMarkerRadius, CORE_RADIUS, t))
        .stroke({ width: 2, color, alpha })
        .circle(m.x, m.y, CORE_RADIUS * (1 - t * 0.5))
        .fill({ color, alpha: alpha * 0.9 });
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
