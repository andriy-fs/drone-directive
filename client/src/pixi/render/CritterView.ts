import { Container, Sprite } from 'pixi.js';
import { gameConfig } from '../../config/gameConfig';
import { CRITTER_CYCLE_MS } from '../../config/sprites';
import type { TerrainGrid } from '../../engine/obstacles';
import { getCritterTextures, type ResolvedSprite } from '../assets';
import { critterAnchors } from './terrain/critters';
import { cellAt } from './cycle';

/** One placed creature and everything needed to advance its loop. */
interface Critter {
  sprite: Sprite;
  frames: ResolvedSprite[];
  phase: number;
  frame: number;
}

/**
 * Draws the plateau critters: at most two decorative creatures standing on the interior
 * of a large mountain cluster, animating there for the whole match.
 *
 * **Purely presentational, like `RallyView` and for the same reason** — no ECS entity
 * backs one, so a cosmetic object never enters the world the desync hash iterates. It
 * goes further than the rally flags do: a critter is not merely un-simulated, it is
 * unreachable. Mountains block movement and line of fire, so nothing can drive onto it
 * or shoot it, and there is no hit test, no health and no owner to write.
 *
 * Placement is decided once, in `render/terrain/critters.ts`, from a coordinate hash —
 * never the engine `Rng`, whose stream is the simulation itself.
 *
 * **Lives on the `ground` layer, above the terrain view.** That is the whole
 * implementation of "hidden by fog": `layers.fog` sits above `ground` and below `units`,
 * so `FogView` paints over an unexplored critter opaquely and dims a remembered one,
 * exactly as it does the rock underneath. Nothing here knows fog exists.
 */
export class CritterView {
  readonly container: Container;
  private readonly critters: Critter[] = [];

  constructor(terrain: TerrainGrid) {
    this.container = new Container();
    this.container.label = 'critters';
    // Visual only: never intercept pointer hit-testing. A creature the player could
    // click would be a unit they cannot order, which is worse than no creature.
    this.container.eventMode = 'none';

    const { tilePx } = gameConfig.grid;
    for (const anchor of critterAnchors(terrain)) {
      // All-or-nothing per species: no sheet, no creature. The plateau is simply empty,
      // which is what it looked like before this existed.
      const frames = getCritterTextures(anchor.kind);
      if (!frames) continue;

      const first = frames[0];
      const sprite = new Sprite(first.texture);
      sprite.anchor.set(0.5);
      sprite.position.set((anchor.tx + 0.5) * tilePx, (anchor.ty + 0.5) * tilePx);
      const target = first.def.targetSize ?? tilePx * 2;
      sprite.scale.set(target / (first.texture.width || target));
      // A few degrees only, and never a flip: the light is baked into this art (see
      // `critterSprites`), so anything more would move that creature's sun.
      sprite.rotation = anchor.jitter;

      this.container.addChild(sprite);
      this.critters.push({ sprite, frames, phase: anchor.phase, frame: 0 });
    }
  }

  /**
   * Advances every loop off the wall clock — these things animate standing still, so
   * there is no travel to clock them by (`render/gait.ts` covers when that applies).
   *
   * Each creature carries its own `phase`, so two on one map are never in step; two
   * breathing together read as one animation playing in two places.
   */
  update(now: number): void {
    for (const critter of this.critters) {
      // Swap only on a cell change, the guard `BaseView` and `RobotView` both use.
      const frame = cellAt(now, CRITTER_CYCLE_MS, critter.phase, critter.frames.length);
      if (frame === critter.frame) continue;
      critter.frame = frame;
      critter.sprite.texture = critter.frames[frame].texture;
    }
  }

  destroy(): void {
    this.critters.length = 0;
    this.container.destroy({ children: true });
  }
}
