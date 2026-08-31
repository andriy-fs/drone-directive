import { GlProgram, Shader, type Texture } from 'pixi.js';
import { gameConfig } from '../../../../config/gameConfig';
import { glsl } from '../glsl';
import { CRATER_DROP, LINE_STRIDE, MOUNTAIN_RISE, SLOPE_MAX } from './geometry';

/**
 * The one shader the wireframe ground is drawn with.
 *
 * **GLSL only, no WGSL** — the same rule as `render/terrain/terrainShaders.ts`, and
 * for the same reason: `GameApp` pins the renderer to WebGL, and a program with no
 * `gpuProgram` would be silently dropped rather than fail loudly. Adding WebGPU
 * means adding a `gpuProgram` here and in the other two files, and nothing else.
 *
 * The vertex stage is the odd one in this project: it needs a perspective divide,
 * and the `mat3` the container hierarchy carries cannot express one. So the camera
 * lives in `uViewProj` — the same sixteen numbers `fpv/camera.ts` hands the CPU
 * side, never a second copy of the derivation — and Pixi's own matrices are applied
 * **after** it rather than instead of it.
 *
 * **Applying them is not optional, and skipping it was a bug.** This shader used to
 * write `gl_Position` straight out of `uViewProj`, which is correct only while the
 * mesh renders to the canvas. Under a filter Pixi draws the container into a pooled
 * offscreen texture — `TexturePool` rounds **up to a power of two**, so a 980×800
 * viewport becomes a 1024×1024 target — binds the whole thing, and compensates in
 * the matrices it supplies. A shader emitting its own NDC ignores that compensation
 * and spreads across the entire pooled texture, of which only the frame is then
 * sampled: the ground came out stretched, shoved up the screen and clipped at the
 * bottom, while the machines standing on it (drawn through Pixi's transform like
 * everything else) stayed where they belonged. It also silently assumed the canvas's
 * `y` direction, which a render texture is free not to share.
 *
 * The composition keeps the near-plane clipping intact, which is the part worth
 * being careful about: `uViewProj` yields pixels *premultiplied by `w`*, Pixi's
 * matrix is affine, so the product is still linear in clip space. `z` and `w` are
 * passed through untouched and GL cuts a line crossing the near plane in exactly
 * the place it did before — which matters, because grid lines run from under the
 * hull out past the horizon.
 *
 * Four effects ride along in the fragment stage, and every one of them is load-bearing
 * rather than decorative:
 *
 * - **The distance fade** is what stops the picture becoming noise. A wireframe has
 *   no occlusion and no perspective cue beyond line convergence, so without a falloff
 *   the far half of the map lands as a solid mat of pixels across the horizon. It also
 *   hides the far clip, and it is most of what makes the thing read as a monitor.
 * - **The fog** is not a nicety: the ground mesh is the *whole map*, built once, so
 *   without a mask the view would hand the player a free survey of terrain their side
 *   has never been near. Sampling it per fragment (rather than baking it into the
 *   geometry) is what lets the geometry stay static while the mask changes all match.
 * - **The coverage term** is an honest level of detail. Past a certain range the
 *   grid's spacing collapses below the pixel raster, and a lattice sampled under its
 *   own Nyquist limit does not fade out — it beats against the raster and turns the
 *   horizon into moire. So a line is dimmed by how much of one lattice cell a pixel
 *   can actually hold, which goes to nothing exactly where there is nothing left to
 *   resolve.
 *
 *   **It is computed in the vertex stage, and `fwidth` was the wrong tool.** The
 *   obvious spelling is a screen-space derivative of `vWorld` in the fragment stage,
 *   and it blanked the entire ground on real hardware. Derivatives are differenced
 *   across a 2x2 pixel quad, this mesh is a `line-list`, and a one-pixel line never
 *   fills a quad — GLES leaves the result undefined there, and what came back was
 *   large enough (or NaN enough) to discard every fragment in the view. The fix is to
 *   stop asking a neighbouring fragment and ask the matrix instead: the exact
 *   projective derivative of `uViewProj` along each lattice axis is two mat-vecs and
 *   a divide, it is defined at every vertex whatever primitive it belongs to, and it
 *   is clamped into 0..1 before it leaves the vertex stage so no arithmetic downstream
 *   of a clipped vertex can put the ground back in the dark.
 * - **The shading** — slope into brightness, depth into hue — is the only thing in
 *   this view that distinguishes a wall from the apron at its foot from the flat
 *   beside it. All three are lines of one colour otherwise, and the relief the vertex
 *   stage went to such trouble to build arrives at the eye as an even grey. A crater
 *   in particular has no silhouette to give it away: it is a hole, and from a metre
 *   off the ground a hole and a plain look alike until one of them is a different
 *   colour.
 */

/**
 * @param fog         Tile-resolution mask texture — see `fogMask.ts`. Its red channel
 *                    is the weight a line is drawn at, so "unexplored" is simply zero.
 * @param worldSize   Map size in world px, for turning a world position into a fog UV.
 * @param color       Line colour at and above ground level, linear 0..1. Output is
 *                    premultiplied for normal blend.
 * @param colorLow    Line colour at the floor of the deepest crater, linear 0..1.
 *                    Everything between the two is a mix on depth.
 * @param fade        Where the falloff starts and where it reaches nothing, in world px.
 */
export function createFpvTerrainShader(
  fog: Texture,
  worldSize: readonly [number, number],
  color: readonly number[],
  colorLow: readonly number[],
  fade: { start: number; end: number },
): Shader {
  const glProgram = GlProgram.from({
    name: 'fpv-terrain',
    vertex: glsl`in vec2 aPosition;
in float aHeight;
in float aSlope;

out vec2 vWorld;
out float vFade;
out float vHeight;
out float vSlope;
out float vCover;

// World to canvas pixels, homogeneous — see fpv/camera.ts.
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec2 uFade;

// Pixi's own transform chain. The names are a contract with the renderer's bind
// groups, not a choice: uProjectionMatrix and uWorldTransformMatrix come from the
// global group and uTransformMatrix from the mesh's local one.
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

// One cell of the drawn lattice, in world px — LINE_STRIDE tiles. Baked in from the
// module that decides it rather than passed as a uniform: it is a property of the
// buffer this program was compiled for, and a second copy of LINE_STRIDE living in a
// string is exactly the kind of number that goes stale.
const float GRID_PX = ${(gameConfig.grid.tilePx * LINE_STRIDE).toFixed(1)};
// Spacing at which a line starts to alias rather than recede, in canvas px. Two, not
// one: a raster stops resolving a pattern at half its period, not at its period.
const float NYQUIST_PX = 2.0;

void main() {
    vec3 world = vec3(aPosition, aHeight);
    // .xy is the canvas pixel position times w; handing that and w to Pixi's affine
    // mat3 keeps everything linear, so no divide happens before the rasteriser's.
    vec4 pixel = uViewProj * vec4(world, 1.0);
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    vec3 placed = mvp * vec3(pixel.xy, pixel.w);
    // w comes from our own matrix rather than from placed.z: the two agree for an
    // affine mat3, and saying so here is what keeps the near-plane clip honest if
    // that ever stops being true.
    gl_Position = vec4(placed.xy, pixel.z, pixel.w);
    vWorld = aPosition;
    // Fade by true distance from the eye, not by view depth: at the edges of a 66°
    // field the two differ by a quarter, and keying off depth would draw a brighter
    // band across the corners of the screen that follows the camera as it turns.
    vFade = 1.0 - clamp((distance(world, uEye) - uFade.x) / max(uFade.y - uFade.x, 1.0), 0.0, 1.0);
    // Both are constant along a segment (see LineBuilder.segment), so the interpolator
    // is only carrying them across, not between two different values.
    vHeight = aHeight;
    vSlope = aSlope;

    // Canvas px one lattice cell spans here, along each of its two axes. uViewProj
    // gives pixels premultiplied by w, so the screen-space derivative along a world
    // direction d is (M*d).xy/w - pixel.xy*(M*d).w/w^2 — the quotient rule, and the
    // second term is what accounts for the ground going edge-on at the horizon, which
    // is the whole reason a far grid aliases in the first place.
    // Behind the near plane w is meaningless; the floor sends those to full coverage,
    // which is the safe direction — a clipped vertex may only ever brighten the piece
    // of line that is actually on screen.
    float w = max(pixel.w, 1e-3);
    vec2 sx = (uViewProj[0].xy * w - pixel.xy * uViewProj[0].w) * (GRID_PX / (w * w));
    vec2 sy = (uViewProj[1].xy * w - pixel.xy * uViewProj[1].w) * (GRID_PX / (w * w));
    // The tighter of the two axes is the one that aliases; the other is running away
    // from the camera and spacing out.
    vCover = clamp(min(length(sx), length(sy)) / NYQUIST_PX, 0.0, 1.0);
}
`,
    // `precision highp float;` must literally start the source — Pixi's
    // `ensurePrecision` only honours an existing declaration that way and otherwise
    // prepends **mediump**, which matters here because `vWorld` reaches 2560 on the
    // large map and fp16 would quantise the fog lookup into visible steps.
    fragment: glsl`precision highp float;
in vec2 vWorld;
in float vFade;
in float vHeight;
in float vSlope;
in float vCover;

out vec4 finalColor;

uniform sampler2D uFog;
uniform vec2 uWorldSize;
uniform vec3 uColor;
uniform vec3 uColorLow;

// Depth at which the ground has taken the crater colour outright — one step down,
// which is the rim, so the whole rim reads cold and only the floor goes further.
const float CRATER_REF = ${CRATER_DROP.toFixed(1)};
const float SLOPE_MAX = ${SLOPE_MAX.toFixed(1)};
// How far up the white a slope goes, per unit of rise over run, and how far that is
// ever allowed to get.
//
// **The first pass at 0.35 was not visible and may as well not have been there.** A
// grid line on the flank of a massif runs about 0.5, which put it a sixth of the way
// to white — a change of a few units per channel on a line one pixel wide, against a
// black tube, under a distance fade. At 0.75 the same flank lands a third of the way
// and a wall goes to the ceiling, which is the separation the pass exists to draw.
// The ceiling is short of 1.0 on purpose: a line that reached pure white would be
// indistinguishable from fpv.self, and the hull the pilot is riding is the one thing
// on this screen that must never have competition.
const float SLOPE_GAIN = 0.75;
const float SLOPE_CEIL = 0.8;
// And how much of the fade a slope may claw back. Brightness alone is not enough at
// range: past FADE.start every line is being multiplied toward nothing, so a cliff
// at 700 px would go out exactly as fast as the flat around it. Half again, capped at
// opaque, keeps the thing you must not drive into legible for as long as the monitor
// draws anything at all.
const float SLOPE_LIFT = 0.5;

void main() {
    float seen = texture(uFog, vWorld / uWorldSize).r;
    float a = vFade * seen * vCover;
    // Never-explored ground is not dimmed, it is absent — and discarding rather than
    // blending zero keeps the far edge of the explored region from leaving a seam.
    // Tested before the slope lift, so fog and range keep the last word on what exists.
    if (a < 0.004) discard;

    float steep = clamp(vSlope, 0.0, SLOPE_MAX);
    // Hue carries depth, brightness carries steepness. Toward white rather than up the
    // channels: uColor is already near-saturated in green, so scaling it would clip to
    // a flat slab long before a rib got bright, and the mix keeps the ramp linear.
    vec3 tint = mix(uColor, uColorLow, clamp(-vHeight / CRATER_REF, 0.0, 1.0));
    tint = mix(tint, vec3(1.0), min(SLOPE_GAIN * steep, SLOPE_CEIL));
    a = min(a * (1.0 + SLOPE_LIFT * steep), 1.0);
    finalColor = vec4(tint * a, a);
}
`,
  });

  return new Shader({
    glProgram,
    resources: {
      uFog: fog.source,
      fpvUniforms: {
        uViewProj: { value: new Float32Array(16), type: 'mat4x4<f32>' },
        uEye: { value: new Float32Array(3), type: 'vec3<f32>' },
        uFade: { value: new Float32Array([fade.start, fade.end]), type: 'vec2<f32>' },
        uWorldSize: { value: new Float32Array(worldSize), type: 'vec2<f32>' },
        uColor: { value: new Float32Array(color), type: 'vec3<f32>' },
        uColorLow: { value: new Float32Array(colorLow), type: 'vec3<f32>' },
      },
    },
  });
}

/**
 * The shader the **filled** ground is drawn with — `ground/fill.ts`'s triangles.
 *
 * A near-copy of the wireframe's vertex stage rather than a shared chunk, and that is
 * a deliberate call: the two differ in what they carry (a facet has a normal and no
 * slope; a line has a slope and no normal) and in what they must not do (a solid
 * surface has no Nyquist limit, so the coverage term that keeps the lattice from
 * moireing has nothing to do here and would only dim the far ground twice). What they
 * share is the projection, and *that* is not duplicated in spirit: both read the same
 * `uViewProj` the CPU side hands them, and the composition with Pixi's own matrices
 * below is the same four lines for the same reason — see the header of this file.
 *
 * **Drawn additively**, which is what lets it be one static buffer. Painter's order
 * for a heightfield depends on where the eye stands, so an opaque pass would have to
 * re-emit its indices whenever the hull crossed a tile; additive is order-independent
 * and costs nothing to leave alone. What it buys instead of occlusion is depth by
 * *tone*: a facet turned toward the light adds more than one turned away, and two
 * planes meeting at an angle stop being one surface.
 *
 * @param colorHigh Line colour at the top of the tallest landform, linear 0..1.
 *                  Below ground the gradient runs the other way, into `colorLow`.
 */
export function createFpvFillShader(
  fog: Texture,
  worldSize: readonly [number, number],
  color: readonly number[],
  colorLow: readonly number[],
  colorHigh: readonly number[],
  fade: { start: number; end: number },
): Shader {
  const glProgram = GlProgram.from({
    name: 'fpv-fill',
    vertex: glsl`in vec2 aPosition;
in float aHeight;
in float aShade;

out vec2 vWorld;
out float vFade;
out float vHeight;
out float vShade;

uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec2 uFade;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    vec3 world = vec3(aPosition, aHeight);
    vec4 pixel = uViewProj * vec4(world, 1.0);
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    vec3 placed = mvp * vec3(pixel.xy, pixel.w);
    gl_Position = vec4(placed.xy, pixel.z, pixel.w);
    vWorld = aPosition;
    vFade = 1.0 - clamp((distance(world, uEye) - uFade.x) / max(uFade.y - uFade.x, 1.0), 0.0, 1.0);
    vHeight = aHeight;
    vShade = aShade;
}
`,
    fragment: glsl`precision highp float;
in vec2 vWorld;
in float vFade;
in float vHeight;
in float vShade;

out vec4 finalColor;

uniform sampler2D uFog;
uniform vec2 uWorldSize;
uniform vec3 uColor;
uniform vec3 uColorLow;
uniform vec3 uColorHigh;

// Where each end of the gradient is reached. Below: the rim of a crater, so the whole
// rim reads cold and only the floor goes further. Above: two steps of MOUNTAIN_RISE,
// the interior of a massif — a rim tile is one step, so a landform runs most of the
// gradient across its own flank rather than saturating at its foot.
const float CRATER_REF = ${CRATER_DROP.toFixed(1)};
const float CREST_REF = ${(MOUNTAIN_RISE * 2).toFixed(1)};
// How solid the surface is allowed to be. Low on purpose: this is a monitor whose
// subject is the machines on it, and a ground that competes with fpv.self for
// attention has taken the picture over. It reads as light on a surface, not as paint.
const float FILL_ALPHA = 0.22;

void main() {
    float seen = texture(uFog, vWorld / uWorldSize).r;
    float a = vFade * seen * FILL_ALPHA;
    // Same rule as the lattice: unexplored ground is absent rather than dim, and
    // discarding keeps the edge of the explored region from leaving a seam.
    if (a < 0.004) discard;
    vec3 tint = vHeight < 0.0
        ? mix(uColor, uColorLow, clamp(-vHeight / CRATER_REF, 0.0, 1.0))
        : mix(uColor, uColorHigh, clamp(vHeight / CREST_REF, 0.0, 1.0));
    finalColor = vec4(tint * vShade * a, a);
}
`,
  });

  return new Shader({
    glProgram,
    resources: {
      uFog: fog.source,
      fpvUniforms: {
        uViewProj: { value: new Float32Array(16), type: 'mat4x4<f32>' },
        uEye: { value: new Float32Array(3), type: 'vec3<f32>' },
        uFade: { value: new Float32Array([fade.start, fade.end]), type: 'vec2<f32>' },
        uWorldSize: { value: new Float32Array(worldSize), type: 'vec2<f32>' },
        uColor: { value: new Float32Array(color), type: 'vec3<f32>' },
        uColorLow: { value: new Float32Array(colorLow), type: 'vec3<f32>' },
        uColorHigh: { value: new Float32Array(colorHigh), type: 'vec3<f32>' },
      },
    },
  });
}
