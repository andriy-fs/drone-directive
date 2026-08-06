import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { Vec2 } from '@drone-directive/types/entities';

/** The enemy under the cursor that the current selection could attack. */
export interface HoverTarget {
  /** Centre, in world pixels. */
  pos: Vec2;
  /** Half the target's body size (px): the robot's radius, or half a base's footprint. */
  halfSize: number;
}

/** Gap (px) between the target's body and the brackets, so the sprite stays readable. */
const PADDING = 6;
/** Length (px) of each bracket arm. */
const ARM = 7;

/**
 * Attack-target reticle: four corner brackets with a faintly pulsing box around
 * the enemy under the cursor. Drawn only while the local selection holds a robot
 * that could actually hurt that target (see `selectionCanAttack`), so it reads as
 * "right-click here to attack", not merely "something is under the cursor".
 *
 * Brackets rather than a ring on purpose — a ring would be mistaken for the
 * yellow selection outline `RobotView` already draws.
 *
 * Purely presentational and fed by `GameApp` every frame (the target moves under
 * a stationary cursor), so there is no ECS entity and nothing for the desync hash
 * to see. Its `overlay` layer puts it above the fog: the caller is responsible
 * for never handing it an enemy the local side cannot currently see.
 */
export class HoverTargetView {
  readonly container: Container;
  private readonly gfx = new Graphics();
  private drewLastFrame = false;

  constructor() {
    this.container = new Container();
    this.container.label = 'hover-target';
    // Visual only: never intercept pointer hit-testing.
    this.container.eventMode = 'none';
    this.container.addChild(this.gfx);
  }

  update(target: HoverTarget | null, now: number): void {
    const g = this.gfx;
    if (!target) {
      if (this.drewLastFrame) {
        g.clear();
        this.drewLastFrame = false;
      }
      return;
    }

    const half = target.halfSize + PADDING;
    const { x, y } = target.pos;
    const phase = (now / 1000 / gameConfig.fx.hoverPulsePeriod) * Math.PI * 2;
    const pulse = 0.5 + 0.5 * Math.sin(phase);
    const color = palette.order.attack;

    g.clear();
    this.drewLastFrame = true;

    // Corner brackets: two arms per corner, drawn as one stroked path.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = x + sx * half;
        const cy = y + sy * half;
        g.moveTo(cx - sx * ARM, cy).lineTo(cx, cy).lineTo(cx, cy - sy * ARM);
      }
    }
    g.stroke({ width: 2, color });

    g.rect(x - half, y - half, half * 2, half * 2).stroke({
      width: 1,
      color,
      alpha: 0.2 + pulse * 0.35,
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
