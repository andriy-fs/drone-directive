import { GlProgram, Shader, type Texture } from 'pixi.js';
import { glsl } from '../glsl';

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
 * Two effects ride along in the fragment stage, and both are load-bearing rather
 * than decorative:
 *
 * - **The distance fade** is what stops the picture becoming noise. A wireframe has
 *   no occlusion and no perspective cue beyond line convergence, so without a falloff
 *   the far half of the map lands as a solid mat of pixels across the horizon. It also
 *   hides the far clip, and it is most of what makes the thing read as a monitor.
 * - **The fog** is not a nicety: the ground mesh is the *whole map*, built once, so
 *   without a mask the view would hand the player a free survey of terrain their side
 *   has never been near. Sampling it per fragment (rather than baking it into the
 *   geometry) is what lets the geometry stay static while the mask changes all match.
 */

/**
 * @param fog         Tile-resolution mask texture — see `fogMask.ts`. Its red channel
 *                    is the weight a line is drawn at, so "unexplored" is simply zero.
 * @param worldSize   Map size in world px, for turning a world position into a fog UV.
 * @param color       Line colour, linear 0..1. Output is premultiplied for normal blend.
 * @param fade        Where the falloff starts and where it reaches nothing, in world px.
 */
export function createFpvTerrainShader(
  fog: Texture,
  worldSize: readonly [number, number],
  color: readonly number[],
  fade: { start: number; end: number },
): Shader {
  const glProgram = GlProgram.from({
    name: 'fpv-terrain',
    vertex: glsl`in vec2 aPosition;
in float aHeight;

out vec2 vWorld;
out float vFade;

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
}
`,
    // `precision highp float;` must literally start the source — Pixi's
    // `ensurePrecision` only honours an existing declaration that way and otherwise
    // prepends **mediump**, which matters here because `vWorld` reaches 2560 on the
    // large map and fp16 would quantise the fog lookup into visible steps.
    fragment: glsl`precision highp float;
in vec2 vWorld;
in float vFade;

out vec4 finalColor;

uniform sampler2D uFog;
uniform vec2 uWorldSize;
uniform vec3 uColor;

void main() {
    float seen = texture(uFog, vWorld / uWorldSize).r;
    float a = vFade * seen;
    // Never-explored ground is not dimmed, it is absent — and discarding rather than
    // blending zero keeps the far edge of the explored region from leaving a seam.
    if (a < 0.004) discard;
    finalColor = vec4(uColor * a, a);
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
      },
    },
  });
}
