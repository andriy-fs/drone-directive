import { GlProgram, Shader, type Texture } from 'pixi.js';

/**
 * The two shaders the terrain is drawn with.
 *
 * Both replace something that used to be a pile of `Graphics` rectangles redrawn
 * into the frame every tick. The point of moving to a shader is not the shader —
 * it is that the *shape* stops being made of rectangles: a mesh covers only the
 * blocked tiles instead of a world-sized quad the stencil throws 80% of away, and
 * a gradient becomes an interpolated vertex attribute instead of thousands of
 * quantised fills.
 *
 * **GLSL only, no WGSL.** `GameApp` therefore pins the renderer to WebGL
 * explicitly rather than relying on it being first in Pixi's default preference
 * order — a silent fall-through to WebGPU would find these programs missing a
 * `gpuProgram` and drop the terrain. Adding WebGPU support means adding a
 * `gpuProgram` to both of these and nothing else.
 *
 * The uniform names below are not free choices. `uProjectionMatrix` and
 * `uWorldTransformMatrix` come from the renderer's global bind group and
 * `uTransformMatrix` from the mesh's local one; Pixi's mesh adaptor binds both
 * groups by index, so a shader that renames them silently draws at the wrong
 * place (see `GlMeshAdaptor.execute`).
 */

/** Vertex stage shared by both programs: standard Pixi transform, one float passed through. */
function vertexSource(attribute: string, varying: string, extra = ''): string {
  return `
in vec2 aPosition;
in float ${attribute};

out vec2 vWorld;
out float ${varying};

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vWorld = aPosition;
    ${varying} = ${attribute};
    ${extra}
}
`;
}

/**
 * Rock and crater floor: the fill texture sampled in **world space**, tinted by
 * the cluster's depth.
 *
 * Sampling by world position is what makes a cluster read as one landform — the
 * texture simply continues from one tile into the next, so there is no seam to
 * hide and no per-tile repeat to disguise. It requires the texture's source to be
 * set to `repeat`, and it is the reason the fills must stay whole-image assets: a
 * `frame`-cropped sheet shares its source with its neighbours and would bleed.
 *
 * Output is opaque, so premultiplication is a no-op here. The mesh deliberately
 * ignores container alpha — terrain is never faded, and fog is a separate layer
 * drawn over it.
 */
export function createFillShader(
  texture: Texture,
  repeatPx: number,
  tint: readonly number[],
  tintMax: number,
): Shader {
  const glProgram = GlProgram.from({
    name: 'terrain-fill',
    vertex: vertexSource('aDepth', 'vDepth'),
    // `precision highp float;` must be the literal start of the source — Pixi's
    // `ensurePrecision` only honours an existing declaration when the string
    // begins with it, and otherwise prepends **mediump**. That matters here: the
    // UV is a world coordinate over the repeat size, so it reaches ~13 on the
    // large map, and at fp16 that quantises the texture lookup into visible
    // blocks on mobile GPUs. Pixi downgrades this to mediump by itself where the
    // device cannot do better.
    fragment: `precision highp float;
in vec2 vWorld;
in float vDepth;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uRepeatPx;
uniform vec3 uTint;
uniform float uTintMax;

void main() {
    vec3 rock = texture(uTexture, vWorld / uRepeatPx).rgb;
    finalColor = vec4(mix(rock, uTint, vDepth * uTintMax), 1.0);
}
`,
  });

  return new Shader({
    glProgram,
    resources: {
      uTexture: texture.source,
      fillUniforms: {
        uRepeatPx: { value: repeatPx, type: 'f32' },
        uTint: { value: new Float32Array(tint), type: 'vec3<f32>' },
        uTintMax: { value: tintMax, type: 'f32' },
      },
    },
  });
}

/**
 * The mountains' cast shadow: a flat colour whose alpha is carried per vertex.
 *
 * Replaces five copies of the silhouette stacked along the light direction, whose
 * *overlap* was the gradient — five times the overdraw over every mountain, every
 * frame, to fake a ramp the rasteriser will interpolate for nothing.
 *
 * Output is premultiplied because Pixi's normal blend mode expects it.
 */
export function createShadowShader(color: readonly number[]): Shader {
  const glProgram = GlProgram.from({
    name: 'terrain-shadow',
    vertex: vertexSource('aAlpha', 'vAlpha'),
    fragment: `precision highp float;
in vec2 vWorld;
in float vAlpha;

out vec4 finalColor;

uniform vec3 uShadowColor;

void main() {
    finalColor = vec4(uShadowColor * vAlpha, vAlpha);
}
`,
  });

  return new Shader({
    glProgram,
    resources: {
      shadowUniforms: {
        uShadowColor: { value: new Float32Array(color), type: 'vec3<f32>' },
      },
    },
  });
}
