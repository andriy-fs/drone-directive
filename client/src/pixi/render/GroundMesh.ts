import { GlProgram, Geometry, Mesh, Shader, Texture } from 'pixi.js';
import { worldPixelSize } from '../../config/gameConfig';

/**
 * The walkable surface: **one** quad, one draw call, both ground variants blended
 * in the fragment shader.
 *
 * What this replaced is the point. The blend used to be a second `TilingSprite`
 * masked by a `Sprite` holding a noise texture — and in Pixi a `Sprite` mask is not
 * a stencil, it is `AlphaMask`, which allocates an offscreen render target at the
 * renderer's resolution *with MSAA* and composites it through a filter, every
 * frame. Measured on the medium map at dpr 2, that single mask cost **8.6 ms of a
 * 30 ms frame** — more than the entire terrain layer.
 *
 * A per-fragment `mix()` is what the mask was approximating anyway, so doing it
 * directly is both cheaper and more accurate: the blend is now continuous rather
 * than quantised by the mask texture's own alpha resolution.
 *
 * **Why two variants at all:** seamlessness hides the *seam*, not the *period*. One
 * texture repeated across a 1280–2560 px field is uniform everywhere, so the eye
 * finds the rhythm even with no visible joins. Two surfaces with different
 * character, cross-faded by patches hundreds of pixels wide, have no single period
 * to find.
 */

/** GLSL only — see the note in `render/terrain/terrainShaders.ts` about the pinned WebGL renderer. */
const vertex = `
in vec2 aPosition;

out vec2 vWorld;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vWorld = aPosition;
}
`;

/**
 * `uBlend` is 0 when the second variant is missing, which collapses the `mix` to
 * variant A — the degradation contract every other optional asset here follows.
 * `uNoise` is sampled across the whole world, so its texture is tiny (a dozen
 * texels a side) and the GPU's linear filtering does the smoothing for nothing.
 */
const fragment = `precision highp float;
in vec2 vWorld;

out vec4 finalColor;

uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uNoise;
uniform float uRepeatPx;
uniform vec2 uWorldSize;
uniform float uBlend;

void main() {
    vec2 uv = vWorld / uRepeatPx;
    vec3 a = texture(uTexA, uv).rgb;
    vec3 b = texture(uTexB, uv).rgb;
    float m = texture(uNoise, vWorld / uWorldSize).r * uBlend;
    finalColor = vec4(mix(a, b, m), 1.0);
}
`;

/** A single quad spanning the world, in world pixels. */
function worldQuad(): Geometry {
  const { width, height } = worldPixelSize;
  return new Geometry({
    attributes: {
      aPosition: { buffer: new Float32Array([0, 0, width, 0, width, height, 0, height]), format: 'float32x2' },
    },
    indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

/**
 * @param base    Variant A — the surface itself.
 * @param alt     Variant B, or null to draw variant A alone.
 * @param noise   Small grayscale texture driving the blend; read from the red channel.
 * @param repeatPx Field pixels one repeat of a ground texture covers.
 */
export function createGroundMesh(
  base: Texture,
  alt: Texture | null,
  noise: Texture,
  repeatPx: number,
): Mesh<Geometry, Shader> {
  // World-space sampling needs both sources to wrap. Both are whole-image assets
  // with a source of their own, so this cannot affect anything else.
  base.source.addressMode = 'repeat';
  if (alt) alt.source.addressMode = 'repeat';

  const shader = new Shader({
    glProgram: GlProgram.from({ name: 'ground-blend', vertex, fragment }),
    resources: {
      uTexA: base.source,
      uTexB: (alt ?? base).source,
      uNoise: noise.source,
      groundUniforms: {
        uRepeatPx: { value: repeatPx, type: 'f32' },
        uWorldSize: {
          value: new Float32Array([worldPixelSize.width, worldPixelSize.height]),
          type: 'vec2<f32>',
        },
        uBlend: { value: alt ? 1 : 0, type: 'f32' },
      },
    },
  });

  const mesh = new Mesh({ geometry: worldQuad(), shader });
  mesh.label = 'ground-blend';
  return mesh;
}
