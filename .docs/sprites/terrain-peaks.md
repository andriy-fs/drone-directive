# Terrain decal prompt — mountain peaks

A **2×2 sheet of four ridge/summit decals**, laid over the mountain fill at the
interior high points of each cluster. This is what turns a shaded blob into a
mountain range.

## Why this asset exists

The mountain fill ([obstacle-mountain.md](obstacle-mountain.md)) is deliberately
flat and shapeless — it is material, not form. The procedural passes in
`TerrainView` then give a cluster an *outline* (cast shadow, boundary rim) and a
*gradient* (depth shading). What neither can give it is **internal structure**: a
real massif has crests and summits somewhere in its middle, not a smooth dome.

These decals supply that. `TerrainView` runs a distance transform over each
mountain cluster, takes the local maxima of the depth field, and drops a peak
there — variant, rotation and scale chosen from a pure hash of the anchor's tile
coordinates (never the engine `Rng`, which would desync lockstep).

## The one asset in the set with baked lighting

Every other terrain texture is forbidden any light of its own, because the engine
lights the silhouette. **A peak is the exception, and it is intentional.** It is
not a surface being lit — it *is* the lit form, the small piece of the cluster
that stands above the rest. So the light goes into the art, and it must match the
engine's global light vector exactly: **from the upper left (northwest).**

Still forbidden: a **cast** shadow. The engine draws the cluster's shadow from the
silhouette; a second one baked under a decal would sit in the wrong place and give
the cluster two suns.

## Spec

- **View:** strict orthographic **top-down**.
- **Layout:** four formations, one per 512² quadrant of a 1024² frame, each with
  clear padding. Nothing may touch a quadrant border — the game crops each
  quadrant with `SpriteDef.frame`, so anything on the boundary is sliced.
- **Background:** **fully transparent.** No frame, no separators, no labels, no
  base plate, no halo, no outline.
- **Edges: feathered.** The outer flanks must fade into transparency rather than
  being cut off hard, so a peak blends into the rock fill underneath instead of
  reading as a sticker. This is the single most common way this asset fails.
- **Lighting: baked, from the upper left.** Crest lines and up-left-facing planes
  catch the light; down-right-facing planes fall to shadow. No cast shadow.
- **Four distinct forms**, so a large cluster doesn't repeat one silhouette:
  a long diagonal ridge; a Y-shaped ridge junction; a compact faceted summit; a
  broken flat-topped block split by a cleft.
- **Palette:** the same cold blue-gray stone as the fill, but this is where the
  terrain's brightest value lives — shadowed flanks near `#121826`, lit crests up
  to about `#5b6b88`. No snow, no ice, no white, no glow, no warm tones. The peak
  is the top of the value range, not an exception to it.
- **On-field scale:** shipped at 512² (each quadrant 256²), drawn at roughly
  **90 px** — about 3 tiles. Bold planes, minimal fine detail.

## Prompt

```text
A 2x2 grid of four separate top-down rock ridge formations on a fully transparent background, for a
stylized RTS game. One formation per quadrant, each centered in its own 512x512 quadrant with clear
padding, never touching the quadrant borders and never overlapping its neighbours. No frame, no
separator lines, no labels, no background of any kind — pure alpha between and around the shapes.

Each formation is the raised crest of a rocky mountain ridge seen from directly overhead: a few large
angular rock planes meeting along a sharp crest line. Lit consistently from the UPPER LEFT (northwest):
the crest line and the planes facing up-left catch the light, the planes facing down-right fall away
into deep shadow, so the height is unmistakable. Bake this lighting into the art. Do NOT draw a cast
shadow on the ground and do NOT draw any ground, base plate, halo or outline — the engine adds the
cast shadow itself.

The four variants: (1) a long ridge running diagonally, (2) a Y-shaped junction where two ridges meet,
(3) a compact steep summit with three or four facets, (4) a broken flat-topped block split by a cleft.

Each shape has an irregular, organic, non-symmetric outline. Its outer edges are FEATHERED and softly
faded into transparency rather than cut off hard, so the formation can blend into the surrounding rock
texture instead of reading as a sticker pasted on top.

Colour: the same cold, desaturated blue-gray stone as the surrounding bedrock — shadowed flanks falling
to about #121826 and lit crests rising to about #5b6b88 at their brightest. No warm tones, no brown, no
rust, no snow, no ice, no white highlights, no glow.

Style: clean stylized semi-flat RTS game art, bold geometric rock planes, crisp cel shading, low
saturation, minimal fine detail. Each formation must read as a raised ridge at roughly 90 screen pixels.

Square image, 1024x1024, transparent PNG.
```

## How it is wired up

1. Master at `client/assets-src/sprites/terrain-peaks.png` — **1024²**,
   transparent PNG.
2. `scripts/encode-sprites.mjs` ships it as `public/terrain-peaks.webp` at
   **512²** (`alpha: true`, **not** `seamless` — it is a sheet, not a tile).
3. `peakSprites` in `src/config/sprites.ts`: four entries sharing one `src`, each
   with a `frame` crop of 256×256 out of the shipped 512² sheet, plus
   `targetSize`. The `frame` mechanism is the same one the tracks chassis used for
   its reference sheet — no new machinery.
4. `TerrainView` places them at `peakAnchors()` from
   `src/pixi/render/terrain/clusters.ts`.

**Optional by design.** A missing file resolves to `null` in `pixi/assets.ts` and
`TerrainView` simply draws no peaks — the fill, shadow, depth and rim still make a
readable massif. Generate this second, after the fills.
