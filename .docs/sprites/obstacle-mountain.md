# Obstacle tile prompt — mountain

The impassable-terrain tile currently in use — **a rocky mountain massif**. The
crater in [obstacle-crater.md](obstacle-crater.md) is the alternative type: same
job, same constraints, opposite elevation — the crater sinks below the battlefield,
this rises above it.

Obstacles are a boolean grid: **each blocked cell is one 32×32 px tile**
(`ObstaclesView` draws one sprite per blocked cell), and cells cluster into
multi-tile blobs, so the tile must **seamlessly tile** — adjacent cells should read
as one continuous mountain, not a grid of squares.

This asset is **terrain, not a unit**, so it intentionally overrides some of the
[Shared spec](README.md): it is **full-bleed and opaque** (no transparent margin,
no centering), and **seamlessly tileable** (opposite edges match).

## Tile-specific spec

- **View:** strict orthographic **top-down**.
- **Bleed:** the rock fills the **entire frame edge-to-edge** — no padding, no
  transparent border. It replaces a solid cell.
- **Seamless:** design so the **left edge matches the right, and top matches
  bottom** (wrap-around tileable). Ridge lines, rock faces and shadows must **run
  off the edges and continue on the opposite side**, so adjacent blocked cells fuse
  into one continuous massif. **No single centered summit** and no radial,
  cone-shaped composition (either telegraphs the grid when tiled) — ridges should
  cross the frame diagonally, reading as a random crop out of one enormous mountain
  range.
- **Must read as impassable — this is the whole point.** It sits next to the flat,
  smooth walkable ground of [ground.md](ground.md), and the contrast has to be
  instant: **the terrain rises up**. Convey height in strict top-down by **lit
  ridge crests and upper slope planes against deep black ravines and shadowed
  flanks** — here the brightest lines read as the tops, the opposite cue to the
  crater's dark-is-deep. **No flat floor anywhere in the frame**, no open ground, no
  pass or valley through.
- **Consistent light with the crater.** Both tiles can appear on the same map, so
  they must be lit the same way — soft even top lighting, **short contact shadows**
  only, never long directional cast shadows (those also fight the tiling).
- **On-field size:** one game tile = **32 px** on screen, and at `maxZoom: 2` on a
  retina display that becomes 128 device px. Author at **512×512** (models can't
  generate usable seamless art below that), then **export downscaled to 128×128** —
  that's 1:1 at max zoom, and resampling in an editor beats a 16× squeeze at draw
  time.
- **Palette — identical to the ground and crater tiles.** Same family as
  [ground.md](ground.md): very dark, muted, desaturated **near-black deep charcoals
  and dark blue-grays**, anchored on the `#0d1117` field background. **No new hues**
  — no lighter slate, no brown, no warm stone, and **no snow, ice or bright peaks**.
  The mountain is the same rock as the terrain around it; it differs by **form and
  light, not colour**. This keeps the **overall value range** dark so bright blue
  (player) and red (enemy) units always pop, while still allowing the crisp local
  edge contrast height needs — the lit crests only a step brighter than the
  surrounding ground, the ravines pure near-black, and no bright highlights
  anywhere.
- **Style:** clean stylized retro-futuristic RTS terrain, semi-flat with light cel
  shading, soft even top lighting.
- **Chunky, not noisy:** a cell is only **32 px** on screen. Use **a few large
  geometric rock planes and ridges**, not a scatter of small stones or scree — fine
  detail disappears at that size and turns the tile into flat noise, which is
  exactly what makes it look drivable.

## Prompt

```text
A perfectly seamless tileable top-down RTS terrain tile representing a steep rocky
mountain massif, viewed from directly above.

This is NOT a walkable ground texture. It is a mass of mountain rock rising sharply
above the surrounding landscape, with steep faces and sheer ravines. The terrain is
clearly much higher than the land around it and cannot be climbed or crossed by
vehicles.

The entire tile is occupied by angular mountain ridges, jagged crests and steep rock
faces falling away on both sides. Deep black ravines and shadowed slopes create a
strong illusion of height. The sharp ridge crests and the upper slope planes catch
the light while the steep flanks and clefts stay in shadow, making the elevation
instantly readable.

There is no flat floor, no paths, no pass or valley through, no open terrain, no
vegetation, no snow, no ice, no sand, no gravel and no scattered boulders. The image
should read as one continuous mountain rock formation rather than individual stones.

Colour: exactly the same palette as the surrounding battlefield ground — a very
dark, muted, desaturated near-black scheme of deep charcoals and dark blue-grays
anchored on a #0d1117 background. It is the same charcoal rock as the terrain around
it and differs only in form and lighting, never in hue: no lighter slate, no brown,
no warm stone, no snow-capped or bright peaks, no new colours. The lit crests are
only a step brighter than the surrounding ground and the ravines fall to near-black,
with no bright highlights anywhere, so the tile stays firmly in the background and
the bright blue and red units always pop against it.

The mountain continues seamlessly beyond every edge of the image. Ridge lines, rock
faces and shadows connect perfectly across opposite edges so repeated tiles form one
enormous continuous mountain range with no visible seams. It fills the entire frame
edge to edge with no border and no transparent margin. Avoid any single centered
summit and any radial or cone-shaped composition — ridges run across the frame and
the image should feel like a random cropped section from a gigantic mountain range.

Lit from directly above with soft even lighting and only short tight contact
shadows, no long directional cast shadows.

Stylized semi-flat RTS game art, clean geometric shapes, subtle cel shading, low
saturation, low visual noise, bold readable forms rather than fine detail, optimized
to remain perfectly readable when reduced to a 32x32 pixel terrain tile.

Square image, 512x512.
```

### Optional: variant tiles to break up repetition

The same blob is tiled from one texture, so a large obstacle can look repetitive.
If you want, generate **2–3 variants** ("same seamless mountain tile, different
ridge arrangement, same palette and style") and have `ObstaclesView` pick one per
cell deterministically (e.g. by tile coordinate) — optional polish, not required.

## How the tile is wired up

Already done — this is the shape of it, for when the tile gets regenerated.

1. Exported as `public/obstacle-mountain.png` (opaque, seamless). **Re-export at
   128×128** — the shipped file is 1024×1024 and gets drawn at 32 px per cell, a 32×
   squeeze that mulches the detail.
2. `terrainSprites[TerrainKind.Mountain]` in `src/config/sprites.ts`, with its `src`
   in `spriteSources()` so it preloads.
3. `createObstaclesGraphic()` in `src/pixi/render/ObstaclesView.ts` places one
   `Sprite` per blocked cell, forced to `tilePx` × `tilePx` (32 px), and falls back
   to the flat `palette.obstacle` fill when the image isn't loaded.

**Gameplay difference from the crater:** the mountain is the kind that blocks *line
of fire* as well as movement (`sightGrid` in `src/engine/obstacles.ts`). Shots are
absorbed by it; shots cross a crater. See [obstacle-crater.md](obstacle-crater.md).
