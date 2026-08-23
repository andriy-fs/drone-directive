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
 * A flat colour whose alpha is carried per vertex — the workhorse of this layer.
 *
 * It started as the mountains' cast shadow, replacing five copies of the silhouette
 * stacked along the light direction whose *overlap* was the gradient: five times the
 * overdraw over every mountain, every frame, to fake a ramp the rasteriser
 * interpolates for nothing. Everything soft here has since been built the same way —
 * the cast shadow, the contact shadow under a cliff, the darkness backing its face,
 * and both boundary rims. The rims are why the colour is no longer called a shadow
 * colour: a lit edge is the same program with a pale one.
 *
 * Output is premultiplied because Pixi's normal blend mode expects it, which is also
 * what lets a light colour and a dark one share it.
 */
export function createFlatShader(color: readonly number[]): Shader {
  const glProgram = GlProgram.from({
    name: 'terrain-flat',
    vertex: vertexSource('aAlpha', 'vAlpha'),
    fragment: `precision highp float;
in vec2 vWorld;
in float vAlpha;

out vec4 finalColor;

uniform vec3 uColor;

void main() {
    finalColor = vec4(uColor * vAlpha, vAlpha);
}
`,
  });

  return new Shader({
    glProgram,
    resources: {
      flatUniforms: {
        uColor: { value: new Float32Array(color), type: 'vec3<f32>' },
      },
    },
  });
}

/**
 * The mountains' rock face — the wall you see on an edge turned away from the light,
 * drawn along the strips `cliffs.ts` builds.
 *
 * **Two programs, one geometry.** With the art present the fragment is a texture
 * lookup; without it, the procedural wall this layer was built and tuned against
 * still draws. The fallback is not dead weight — a missing WebP degrades to a
 * shaded wall rather than to a mountain with no edge, and the procedure is what the
 * lighting was dialled in with (see `.docs/sprites/terrain-cliff.md`).
 *
 * `vU` is the **arc length** along the cluster's contour plus that contour's phase,
 * so a wall stepping down a staircase is one continuous strip of art rather than a
 * row of walls that each start the sheet again. `vV` runs 0 at the top of the *sheet*
 * to 1 at its base and never repeats; a wall shorter than full height starts part-way
 * down it, which is why `vLip` — not `vV` — is what marks the top of the wall. That is
 * also why the texture is sampled with
 * **`mirror-repeat`** (set in `TerrainView`): the wall has to tile along `u`, the
 * master measurably does not wrap, and mirroring makes its ends match by
 * construction. Rock has no readable orientation, so the flipped copies do not read
 * as flipped.
 *
 * Output is premultiplied for Pixi's normal blend.
 */
export function createCliffShader(
  base: readonly number[],
  columnPx: number,
  face: Texture | null,
  repeatPx: number,
  lip: { color: readonly number[]; strength: number; pow: number },
): Shader {
  const glProgram = GlProgram.from({
    name: 'terrain-cliff',
    vertex: `
in vec2 aPosition;
in float aU;
in float aV;
in float aAlpha;
in float aLip;

out float vU;
out float vV;
out float vAlpha;
out float vLip;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
    mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
    gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    vU = aU;
    vV = aV;
    vAlpha = aAlpha;
    vLip = aLip;
}
`,
    fragment: face
      ? `precision highp float;
in float vU;
in float vV;
in float vAlpha;
in float vLip;

out vec4 finalColor;

uniform sampler2D uFace;
uniform float uRepeatPx;
uniform vec3 uLipColor;
uniform float uLipStrength;
uniform float uLipPow;

void main() {
    // u is an arc length over the repeat length; v is 0..1 down the sheet. The art
    // carries the lighting, the lobes and - in its alpha - the broken bottom edge, so
    // the only thing added is the lip: the light catching the break of slope where the
    // wall meets the top of the rock. Without it the two meet on a flat cut, which is
    // what reads as a shape pasted onto the ground rather than as an edge of stone.
    // vAlpha is the facing weight across the wall and fades the apron out as it
    // crosses onto open ground.
    vec4 face = texture(uFace, vec2(vU / uRepeatPx, vV));
    vec3 rgb = face.rgb + uLipColor * (uLipStrength * pow(vLip, uLipPow));
    // Premultiplied by the art's own alpha, so the lip cannot draw a bright line
    // across the transparent gaps in the rubble.
    float a = face.a * vAlpha;
    finalColor = vec4(rgb * a, a);
}
`
      : `precision highp float;
in float vU;
in float vV;
in float vAlpha;
in float vLip;

out vec4 finalColor;

uniform vec3 uBase;
uniform float uColumnPx;

float hash11(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
}

void main() {
    // One lobe of rock per uColumnPx. Two distortions before the split, because a
    // wall of identically wide lobes reads as a row of barrels rather than as stone:
    // a slow sine stretches and squeezes the spacing along the wall, and a
    // per-lobe hash shifts the phase.
    float c = vU / uColumnPx + 0.34 * sin(vU * 0.021);
    float idx = floor(c);
    float f = fract(c + 0.35 * hash11(idx));

    // Treat each lobe as a half-cylinder and light it from the west: nx is the
    // surface normal across the lobe, nz the part facing the camera.
    float nx = f * 2.0 - 1.0;
    float nz = sqrt(max(0.0, 1.0 - nx * nx));
    float lambert = clamp(dot(normalize(vec2(nx, nz)), normalize(vec2(-0.55, 0.83))), 0.0, 1.0);

    // The seam where two lobes meet is the darkest line on the wall.
    float groove = smoothstep(0.0, 0.07, min(f, 1.0 - f));

    // Down the wall: the break of slope at the top is a hard dark line — the one
    // edge in this layer that must not be soft, because it is what separates the
    // top of the rock from its face. Below it the lobes catch light, then lose it
    // into the ground.
    // Keyed off vLip rather than vV so both branches agree about where the top of the
    // wall is: vV is anchored at the base of the sheet, so on a tapering flank it is
    // nowhere near 0 up there.
    float brow = 1.0 - smoothstep(0.87, 1.0, vLip);
    float vert = mix(1.12, 0.66, vV) * mix(0.42, 1.0, brow);
    float strata = 0.93 + 0.07 * sin(vV * 34.0 + hash11(idx + 7.0) * 6.283);
    // Contact darkening, kept to the bottom quarter — a wall that ramps to black
    // over its whole height reads as a row of black pickets, not as rock.
    float contact = 1.0 - 0.34 * smoothstep(0.7, 1.0, vV);

    vec3 rock = uBase * mix(0.62, 1.18, lambert) * mix(0.58, 1.0, groove) * vert * strata * contact;

    float alpha = (1.0 - smoothstep(0.97, 1.0, vLip)) * vAlpha;
    finalColor = vec4(rock * alpha, alpha);
}
`,
  });

  return new Shader({
    glProgram,
    resources: face
      ? {
          uFace: face.source,
          cliffUniforms: {
            uRepeatPx: { value: repeatPx, type: 'f32' },
            uLipColor: { value: new Float32Array(lip.color), type: 'vec3<f32>' },
            uLipStrength: { value: lip.strength, type: 'f32' },
            uLipPow: { value: lip.pow, type: 'f32' },
          },
        }
      : {
          cliffUniforms: {
            uBase: { value: new Float32Array(base), type: 'vec3<f32>' },
            uColumnPx: { value: columnPx, type: 'f32' },
          },
        },
  });
}
