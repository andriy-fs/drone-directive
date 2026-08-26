import { glsl } from '../glsl';

/**
 * The two stages of the feed filter — the class that binds them and the reasons
 * the effects exist are in `./FeedFilter.ts`.
 */

/**
 * Pixi's own filter vertex stage, copied rather than imported: `defaultFilter.vert`
 * is internal to the package and not re-exported. The three uniforms it reads come
 * from the filter system's global bind group, so their names are a contract, not a
 * choice — see `FilterSystem`.
 */
export const FEED_VERTEX = glsl`in vec2 aPosition;
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

export const FEED_FRAGMENT = glsl`precision highp float;
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
