import { Filter, GlProgram } from 'pixi.js';

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
 */

/**
 * Pixi's own filter vertex stage, copied rather than imported: `defaultFilter.vert`
 * is internal to the package and not re-exported. The three uniforms it reads come
 * from the filter system's global bind group, so their names are a contract, not a
 * choice — see `FilterSystem`.
 */
const VERTEX = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}
`;

const FRAGMENT = `precision highp float;
in vec2 vTextureCoord;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec4 uOutputFrame;

uniform float uTime;
uniform float uJam;
uniform float uStatic;

/**
 * A cheap value hash. Not the terrain's coordinate hash (that one has to be
 * identical on both peers, because it places art in the world) — this is per
 * frame, per pixel and per viewer, and nothing downstream reads it.
 */
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Sample the input, kept inside the frame — a filter texture is pooled and its margin holds someone else's pixels. */
vec3 tap(vec2 uv) {
    return texture(uTexture, clamp(uv, uInputClamp.xy, uInputClamp.zw)).rgb;
}

void main() {
    // 0..1 across the output frame, whatever size the pooled texture happens to be.
    vec2 screen = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    vec2 centred = screen - 0.5;

    // Interference tears the picture in horizontal bands that jump every few
    // frames — the classic broken-lock artefact, and the reason it reads as
    // something being done *to* the feed rather than as a rendering fault.
    float band = floor(screen.y * 90.0);
    float tear = (hash(vec2(band, floor(uTime * 18.0))) - 0.5) * uJam * uJam * 0.09;
    // A slower, whole-picture roll on top, so the tearing is not the only motion.
    tear += sin(uTime * 3.1 + screen.y * 12.0) * uJam * 0.006;
    vec2 uv = vTextureCoord + vec2(tear, 0.0) * uOutputFrame.zw * uInputSize.zw;

    // Chromatic aberration, radial and scaled by r^2: the middle of the tube stays
    // sharp and the corners smear, which is where a real lens loses convergence.
    // Jamming widens it, so the colour comes apart as the signal does.
    float r2 = dot(centred, centred);
    vec2 fringe = centred * (0.0022 + uJam * 0.02) * r2 * 4.0;
    vec2 fringeUv = fringe * uOutputFrame.zw * uInputSize.zw;
    vec3 color = vec3(tap(uv + fringeUv).r, tap(uv).g, tap(uv - fringeUv).b);

    // Scan lines, in *screen* pixels rather than in uv, so the pattern does not
    // stretch with the window. Drifting slowly, which is what stops a static
    // pattern from reading as a texture printed on the glass.
    //
    // Kept gentle on purpose. This picture is thin bright lines on black, and a
    // deep scan line does not band it — it chops every line in it into a dashed
    // one, which costs legibility for an effect the player would read as a
    // rendering fault.
    float line = sin((screen.y * uOutputFrame.w + uTime * 14.0) * 1.57079633);
    color *= 1.0 - 0.26 * line * line;

    // Grain: a little everywhere, a lot under interference.
    float grain = hash(screen * uOutputFrame.zw + fract(uTime) * 91.7) - 0.5;
    color += grain * (0.035 + uJam * 0.22);

    // Vignette. Also the far end's last defence against the picture reading as a
    // hard clipping plane instead of as distance.
    color *= 1.0 - smoothstep(0.18, 0.78, r2) * 0.85;

    // Electronics down: the tube is showing nothing but its own noise. Full
    // replacement, not a blend — there is no signal to see through it.
    //
    // The distribution matters more than the amplitude: a flat hash over the whole
    // screen averages to a mid tone and reads as felt, not as snow. What makes it
    // snow is that most of it is black with sparse bright grains, so the noise is
    // pushed through a threshold and only the tail survives.
    //
    // (No backticks anywhere in this string, obviously — it is a template literal,
    // and one inside the GLSL ends it. Vite catches that; nothing else here does.)
    float snow = hash(screen * uOutputFrame.zw * 1.7 + fract(uTime * 3.0) * 313.0);
    float speck = smoothstep(0.72, 1.0, snow);
    vec3 dead = (vec3(0.03, 0.05, 0.04) * snow + vec3(0.30, 0.46, 0.36) * speck)
        * (1.0 - smoothstep(0.2, 0.85, r2) * 0.7);
    color = mix(color, dead, uStatic);

    finalColor = vec4(color, 1.0);
}
`;

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
      glProgram: GlProgram.from({ name: 'fpv-feed', vertex: VERTEX, fragment: FRAGMENT }),
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
