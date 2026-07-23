import { Container, Graphics } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { palette } from '../../config/palette';
import type { FogState } from '../../engine/game/context';

/**
 * Renders the player's fog of war from `ctx.fog`: opaque over never-seen tiles
 * (hides the terrain beneath), dimmed over explored-but-not-currently-visible
 * tiles (remembered ground), clear over visible tiles. Lives in the `fog` layer
 * (above ground, below units). Redraws only when the mask's `version` changes.
 */
export class FogView {
  readonly container: Container;
  private readonly gfx = new Graphics();
  private lastVersion = -1;

  constructor() {
    this.container = new Container();
    this.container.label = 'fog';
    // Visual only: never intercept pointer hit-testing.
    this.container.eventMode = 'none';
    this.container.addChild(this.gfx);
  }

  update(fog: FogState | null | undefined): void {
    if (!fog) {
      if (this.lastVersion !== -1) {
        this.gfx.clear();
        this.lastVersion = -1;
      }
      return;
    }
    if (fog.version === this.lastVersion) return;
    this.lastVersion = fog.version;
    this.redraw(fog);
  }

  private redraw(fog: FogState): void {
    const { width, height, tilePx } = gameConfig.grid;
    const g = this.gfx;
    g.clear();

    // Never-seen tiles: one opaque fill hides the terrain.
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (!fog.explored[ty][tx]) g.rect(tx * tilePx, ty * tilePx, tilePx, tilePx);
      }
    }
    g.fill({ color: palette.fog.color, alpha: palette.fog.hiddenAlpha });

    // Explored but not currently in sight: one dim fill (remembered terrain).
    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        if (fog.explored[ty][tx] && !fog.visible[ty][tx]) {
          g.rect(tx * tilePx, ty * tilePx, tilePx, tilePx);
        }
      }
    }
    g.fill({ color: palette.fog.color, alpha: palette.fog.dimAlpha });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
