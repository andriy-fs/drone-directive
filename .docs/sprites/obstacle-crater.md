# Obstacle tile prompt

A prompt for the impassable-terrain tile — **the interior of a collapsed impact
crater**. Obstacles are a boolean grid: **each blocked cell is one 32×32 px tile**
(`ObstaclesView` draws one sprite per blocked cell), and cells cluster into
multi-tile blobs, so the tile must **seamlessly tile** — adjacent cells should read
as one continuous crater, not a grid of squares.

This asset is **terrain, not a unit**, so it intentionally overrides some of the
[Shared spec](README.md): it is **full-bleed and opaque** (no transparent margin,
no centering), and **seamlessly tileable** (opposite edges match).

The other obstacle type — a **mountain**, same spec and palette but rising instead
of sinking — lives in [obstacle-mountain.md](obstacle-mountain.md). That one is the
tile currently wired up.

## Tile-specific spec

- **View:** strict orthographic **top-down**.
- **Bleed:** the rock fills the **entire frame edge-to-edge** — no padding, no
  transparent border. It replaces a solid cell.
- **Seamless:** design so the **left edge matches the right, and top matches
  bottom** (wrap-around tileable). Ledges, cliff edges and shadows must **run off
  the edges and continue on the opposite side**, so adjacent blocked cells fuse into
  one continuous crater. No centered feature and no circular composition (either
  telegraphs the grid when tiled) — it should read as a random crop out of one
  enormous crater.
- **Must read as impassable — this is the whole point.** It sits next to the flat,
  smooth walkable ground of [ground.md](ground.md), and the contrast has to be
  instant: **the terrain drops away**. Convey depth in strict top-down by **flat lit
  upper ledges against deep black fissures and shadowed cliff faces** — the darkest
  areas read as the bottom of the pit. **No flat floor anywhere in the frame**, no
  open ground, no path through.
- **On-field size:** one game tile = **32 px** on screen, and at `maxZoom: 2` on a
  retina display that becomes 128 device px. Author at **512×512** (models can't
  generate usable seamless art below that), then **export downscaled to 128×128** —
  that's 1:1 at max zoom, and resampling in an editor beats a 16× squeeze at draw
  time.
- **Palette — identical to the ground tile.** Same family as
  [ground.md](ground.md): very dark, muted, desaturated **near-black deep charcoals
  and dark blue-grays**, anchored on the `#0d1117` field background. **No new hues**
  — no lighter slate, no brown, no warm stone. The crater is the same rock as the
  terrain around it; it differs by **form and light, not colour**. This keeps the
  **overall value range** dark so bright blue (player) and red (enemy) units always
  pop, while still allowing the crisp local edge contrast depth needs — the lit
  ledges only a step brighter than the surrounding ground, the depths pure
  near-black, and no bright highlights anywhere.
- **Style:** clean stylized retro-futuristic RTS terrain, semi-flat with light cel
  shading, soft even top lighting.
- **Chunky, not noisy:** a cell is only **32 px** on screen. Use **a few large
  geometric rock planes and ledges**, not a scatter of small stones or gravel —
  fine detail disappears at that size and turns the tile into flat noise, which is
  exactly what makes it look drivable.

## Prompt

```text
A perfectly seamless tileable top-down RTS terrain tile representing the interior of
a massive impact crater, viewed from directly above.

This is NOT a walkable ground texture. It is the inside of a deep, impassable crater
with steep rocky walls descending sharply into darkness. The terrain is clearly
lower than the surrounding landscape and cannot be crossed by vehicles.

The entire tile is occupied by fractured crater walls, broken bedrock ledges and
steep rock faces sloping inward. Deep black fissures and shadowed cliff edges create
a strong illusion of depth. The darkest areas read as the deepest parts of the
crater. Flat upper rock surfaces catch the light while the steep walls stay in
shadow, making the elevation instantly readable.

There is no flat floor, no paths, no open terrain, no vegetation, no sand, no gravel
and no scattered boulders. The image should read as one continuous collapsed rock
formation rather than individual stones.

Colour: exactly the same palette as the surrounding battlefield ground — a very
dark, muted, desaturated near-black scheme of deep charcoals and dark blue-grays
anchored on a #0d1117 background. It is the same charcoal rock as the terrain around
it and differs only in form and lighting, never in hue: no lighter slate, no brown,
no warm stone, no new colours. The lit ledges are only a step brighter than the
surrounding ground and the depths fall to near-black, with no bright highlights
anywhere, so the tile stays firmly in the background and the bright blue and red
units always pop against it.

The crater continues seamlessly beyond every edge of the image. Rock layers, cliff
edges and shadows connect perfectly across opposite edges so repeated tiles form one
enormous continuous crater with no visible seams. It fills the entire frame edge to
edge with no border and no transparent margin. Avoid any centered feature or
circular composition — the image should feel like a random cropped section from a
gigantic crater.

Stylized semi-flat RTS game art, clean geometric shapes, subtle cel shading, low
saturation, low visual noise, bold readable forms rather than fine detail, optimized
to remain perfectly readable when reduced to a 32x32 pixel terrain tile.

Square image, 512x512.
```

### Optional: variant tiles to break up repetition

The same blob is tiled from one texture, so a large obstacle can look repetitive.
If you want, generate **2–3 variants** ("same seamless crater-interior tile,
different ledge and fissure arrangement, same palette and style") and have
`ObstaclesView` pick one per cell deterministically (e.g. by tile coordinate) —
optional polish, not required.

## How the tile is wired up

Master at `client/assets-src/sprites/obstacle-crater.png`, shipped by
`scripts/encode-sprites.mjs` as `public/obstacle-crater.webp` at **64×64** — twice
the 32 px cell it is drawn at. Regenerate at any size; the encoder pins the shipped
one (and wrap-pads before scaling so the tile still wraps).

The crater is not just a reskin of the mountain — it is a distinct terrain kind:

- `TerrainKind` (`types/src/enums.ts`) — `open | mountain | crater`.
- `generateObstacles()` rolls the kind **per cluster** (`gameConfig.obstacles.craterChance`),
  never per tile, so a blob is all crater or all mountain.
- The engine derives two boolean grids from it (`src/engine/obstacles.ts`):
  `movementGrid` (mountain **and** crater — pathfinding) and `sightGrid` (mountain
  **only** — line of fire). Hence: **robots must drive around a crater but can shoot
  across it.**
- `terrainSprites` in `src/config/sprites.ts` maps kind → art; `ObstaclesView` picks
  per cell.

No `Math.random()` anywhere in generation — the kind comes from the seeded match
rng, so lockstep peers get identical terrain.
