import { Filter, GlProgram } from 'pixi.js';
import { FEED_FRAGMENT, FEED_VERTEX } from './shader';

/**
 * The monitor itself: vignette, scan lines, grain, chromatic aberration, EW
 * interference and the dead-signal static — **one `Filter`, one fragment shader**.
 *
 * ## Why one and not a chain
 *
 * Every filter in Pixi is a full offscreen pass: the target is measured, a pooled
 * texture is taken, the scene is drawn into it and blitted back. `TerrainView`'s
 * header records what that cost this project once — a single `Sprite` used as a
 * mask, which Pixi routes through the same machinery, ate 8.6 ms of a 30 ms frame.
 * Five effects as five filters would be five of those passes for a picture that is
 * already only lines. So the five live in one `main()`, sharing the one sample
 * they all read, and the cost of the whole look is one pass.
 *
 * `resolution: 1` and `antialias: 'off'` for the same reason, and they cost
 * nothing here: the picture underneath is thin lines on black, and a scan-line
 * pattern is *supposed* to alias — that is what a scan line is.
 *
 * The pass is attached only while a drone is riding a hull and removed on release,
 * so a player who never possesses anything never pays for it. `?feed=0` takes it
 * off for measurement (`perf/perfFlags.ts`); the difference between the two p95s
 * is exactly what this file costs.
 *
 * ## What the artefacts are for
 *
 * Not decoration. Three of them are the only channel two simulation states have:
 *
 * - **Interference** is `uJam`, straight from `jamPressure` in
 *   `engine/systems/vision.ts`. `gameConfig.combat.jamMultiplier` has until now
 *   been a smaller number inside two systems and nothing at all on screen — a
 *   player driving into an `ew` aura had no way to know it. Here it tears the
 *   picture apart, and the closer to the jammer the worse it gets.
 * - **Static** is `uStatic`, from `isDisabled`. While a hull's electronics are
 *   down its monitor shows nothing — which is the second state the player has
 *   never been shown, and the one that explains why the machine has stopped
 *   answering the stick.
 * - **The vignette and the falloff** are what keep the far end of the picture from
 *   reading as a hard clip. The grain and the scan lines are the era.
 *
 * The GLSL for both stages lives next door in `./shader.ts`.
 */

/** What the filter needs told every frame. */
export interface FeedState {
  /** Seconds, wall clock — grain and scan-line drift only, never simulation time. */
  time: number;
  /** `jamPressure` at the hull: 0 outside every aura, 1 on top of a jammer. */
  jam: number;
  /** 1 while the hull's electronics are down (`isDisabled`). */
  dead: number;
}

export class FeedFilter {
  readonly filter: Filter;
  private readonly uniforms: { uTime: number; uJam: number; uStatic: number };

  constructor() {
    this.filter = new Filter({
      glProgram: GlProgram.from({ name: 'fpv-feed', vertex: FEED_VERTEX, fragment: FEED_FRAGMENT }),
      resources: {
        feedUniforms: {
          uTime: { value: 0, type: 'f32' },
          uJam: { value: 0, type: 'f32' },
          uStatic: { value: 0, type: 'f32' },
        },
      },
      // Both deliberate, and both free on a picture made of thin lines: there is
      // no detail to lose at resolution 1, and a scan line is an alias.
      resolution: 1,
      antialias: 'off',
    });
    this.uniforms = this.filter.resources.feedUniforms.uniforms;
  }

  update(state: FeedState): void {
    this.uniforms.uTime = state.time;
    this.uniforms.uJam = state.jam;
    this.uniforms.uStatic = state.dead;
  }

  destroy(): void {
    // Without `true`: `GlProgram.from` caches by source, so the program object is
    // shared with the next filter built from the same shader.
    this.filter.destroy();
  }
}
