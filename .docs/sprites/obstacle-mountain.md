# Terrain fill prompt — mountain rock

The **fill texture** for impassable mountain terrain. The crater floor in
[obstacle-crater.md](obstacle-crater.md) is its counterpart: same job, same rules,
opposite elevation.

## This is a fill, not a tile — read this before generating

The old brief asked for a finished 32 px tile with ledges, ravines and lighting
baked in, drawn once per blocked cell. That is exactly what made a cluster read as
a grid of identical pictures instead of a massif, so **the renderer changed and
this asset changed role with it.**

`TerrainView` now draws **one `TilingSprite` per `TerrainKind` across the whole
world**, masked to the union of that kind's cells. The texture is therefore
continuous in world space — there is no per-cell seam to hide and no per-cell
repeat to disguise. Everything that used to be baked into the tile is now drawn
procedurally on top of the fill, from the cluster's own silhouette:

| Read                    | Where it comes from now                                  |
| ----------------------- | -------------------------------------------------------- |
| Cast shadow             | `Graphics` silhouette, offset by the global light vector |
| Lit / shadowed edges    | per-edge rim along the cluster boundary                  |
| Height falling off      | distance-transform depth shading                          |
| Ridges and summits      | [terrain-peaks.md](terrain-peaks.md) decals               |

**Consequence, and it is the single most important line in this file: the texture
must carry no light of its own.** Any baked sun, shadow, vignette or implied edge
gets a second lighting pass applied on top of it and the cluster falls apart. Flat,
even, ambient — the art supplies *material*, the engine supplies *form*.

## Spec

- **View:** strict orthographic **top-down**.
- **Bleed:** fills the frame edge-to-edge — opaque, no padding, no transparent border.
- **Seamless:** left edge matches right, top matches bottom. Still required: the
  fill repeats every `ROCK_REPEAT_TILES` cells across the world, just no longer
  every cell.
- **No lighting of any kind.** No sun, no directional light, no cast or drop
  shadows, no side-lit highlights, no vignette, no edge darkening, no baked
  ambient occlusion, no implied slope, cliff edge, ridge line or horizon. Every
  part of the frame equally lit and equally high.
- **No dominant form.** No centered feature, no focal point, nothing large enough
  to telegraph the repeat — a random crop out of an enormous rock field.
- **Palette — deliberately *not* identical to the ground.** The old rule ("same
  palette as the ground, differs by form and light, not colour") left the two
  materials indistinguishable once the baked light was removed. Rock is now
  **cold blue-gray and one value step lighter than the ground**, roughly `#1a2130`
  to `#3b4762`, against the ground's `#0d1117` family. The overall mass stays dark
  so units keep popping; the strong contrast is spent **locally**, at the cluster
  boundary, where the rim and shadow are drawn.
- **On-field scale:** shipped at 512², repeating every `ROCK_REPEAT_TILES` (6)
  cells = 192 px of field, a ~2.7× downscale. Author medium-scale forms — a plate
  should be tens of pixels on screen, not two.
- **Chunky, not noisy.** Fine speckle averages to flat mean colour at this
  downscale and reads as drivable gravel, which is the opposite of the point.

## Prompt

```text
A perfectly seamless, tileable top-down texture of bare fractured mountain bedrock, seen from directly
overhead with no perspective.

This is a FILL TEXTURE, not a finished tile and not a scene. It will be stretched across large irregular
rock masses, and every shadow, edge, highlight and sense of elevation is added by the game engine on top
of it. Therefore light it FLATLY and EVENLY, with pure ambient light arriving from every direction at
once. No sun, no directional lighting, no cast shadows, no drop shadows, no side-lit highlights, no
vignette, no darkening toward any edge, no baked ambient occlusion, and no implied slope, cliff edge,
ridge line, horizon or change in elevation anywhere. Every part of the frame must look equally lit and
equally high.

Surface: dense cold bedrock — broad angular rock plates and slabs separated by tight dark fracture lines,
with a coarse mineral grain between them. Medium-scale structure, evenly distributed across the whole
frame. No individual boulders sitting on top, no scree, no gravel heaps, no sand, no vegetation, no snow,
no ice, no man-made objects, no craters.

Colour: cold, desaturated blue-gray stone, roughly one value step LIGHTER than the near-black battlefield
ground it will sit on (#0d1117), staying within a range of about #1a2130 to #3b4762. Muted and dark
overall, with no bright highlights, no warm tones, no brown and no rust.

Seamless: the left edge continues into the right and the top into the bottom with no visible seam when
repeated in a grid. No centered feature, no focal point, no single large form that would telegraph the
repeat — even, homogeneous coverage that reads like a random crop out of an enormous rock field.

Style: clean stylized semi-flat RTS game art, subtle cel shading, low saturation, low visual noise, bold
medium-scale forms rather than fine speckle detail. It must still read as fractured rock when shown at
roughly one third of its authored size.

Square image, 1024x1024.
```

## How it is wired up

1. Master at `client/assets-src/sprites/obstacle-mountain.png` — **1024²**, opaque,
   seamless. The name is unchanged from the old tile because the lookup is still
   keyed by `TerrainKind`; only its role changed.
2. `scripts/encode-sprites.mjs` ships it as `public/obstacle-mountain.webp` at
   **512²** (`alpha: false, seamless: true` — the encoder wrap-pads 3×3 before
   scaling so the wrap survives the downscale).
3. `terrainSprites[TerrainKind.Mountain]` in `src/config/sprites.ts`; its `src` is
   in `spriteSources()` so it preloads.
4. `src/pixi/render/terrain/TerrainView.ts` builds the masked world `TilingSprite`
   and draws shadow, depth and rim over it. A missing texture falls back to the
   flat `palette.obstacle.fill`, and the procedural passes still run — the terrain
   degrades to shaded silhouettes rather than disappearing.

**Gameplay difference from the crater:** the mountain is the kind that blocks
*line of fire* as well as movement (`sightGrid` in `src/engine/obstacles.ts`).
Shots are absorbed by it; shots cross a crater. The rim inversion between the two
(see [obstacle-crater.md](obstacle-crater.md)) is what makes that difference
legible at a glance, so it is a gameplay-readability feature, not decoration.
