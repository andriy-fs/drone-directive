# Obstacle tile prompt

A prompt for the impassable-terrain tile that replaces the flat gray obstacle
cells drawn today. Obstacles are a boolean grid: **each blocked cell is one
32×32 px tile**, and cells cluster into multi-tile blobs, so the tile must
**seamlessly tile** — adjacent cells should read as one continuous rocky outcrop,
not a grid of squares.

This asset is **terrain, not a unit**, so it intentionally overrides some of the
[Shared spec](README.md): it is **full-bleed and opaque** (no transparent margin,
no centering), and **seamlessly tileable** (opposite edges match).

## Tile-specific spec

- **View:** strict orthographic **top-down**.
- **Bleed:** the rock fills the **entire frame edge-to-edge** — no padding, no
  transparent border. It replaces a solid cell.
- **Seamless:** design so the **left edge matches the right, and top matches
  bottom** (wrap-around tileable). No feature touches an edge in a way that
  reveals the seam when repeated. No single focal boulder dead-center (that
  telegraphs the grid when tiled) — favor an even, broken-rock texture.
- **On-field size:** one game tile = **32 px**. Author at **256×256** (min) or
  512×512 so it stays crisp; it will be downscaled and repeated per blocked cell.
- **Palette — must sit *behind* the action:** dark, desaturated **slate / blue-gray
  stone** matching the field (background is near-black `#0d1117`; current obstacle
  fill `#3a3f4a`, edges `#555c68`). Keep it **muted and low-contrast** so bright
  blue (player) and red (enemy) units always pop against it — the obstacle should
  never be the brightest thing on screen.
- **Style:** clean stylized retro-futuristic RTS terrain, semi-flat with light cel
  shading, soft even top lighting. Readable rubble/cracks, but not noisy at 32 px.

## Prompt

```text
A seamless, tileable top-down (bird's-eye) terrain texture tile of dark rocky
rubble for a retro-futuristic RTS, viewed from directly above. Broken slate and
blue-gray stone with scattered rocks, cracks and gravel, evenly distributed with
no single central boulder. Muted, desaturated, low-contrast dark palette (slate
grays and blue-grays on a near-black field) so it reads as impassable background
terrain and never overpowers bright units on top. The texture fills the entire
frame edge-to-edge with no border and no transparent margin, and is perfectly
seamlessly tileable — the left edge continues into the right and the top into the
bottom with no visible seam when repeated in a grid. Clean stylized semi-flat game
art with light cel shading and soft even top lighting, readable but not noisy.
Square image, 512x512.
```

### Optional: variant tiles to break up repetition

The same blob is tiled from one texture, so a large obstacle can look repetitive.
If you want, generate **2–3 variants** ("same seamless dark rubble tile, different
rock arrangement, same palette and style") and have `ObstaclesView` pick one per
cell deterministically (e.g. by tile coordinate) — optional polish, not required.

## Wiring the generated tile into the game

1. Export as `public/obstacle-rock.png` (opaque, seamless).
2. Add an `obstacleSprite` entry to `src/config/sprites.ts` and include its `src`
   in `spriteSources()` so it preloads.
3. In `src/pixi/render/ObstaclesView.ts`, replace the per-cell
   `g.rect(...).fill(...)` with a 32 px `Sprite` (or `TilingSprite`) of the texture
   per blocked cell — same loop, keeping the current flat-fill as the fallback
   when the image isn't loaded. Optionally drop the per-cell edge stroke once the
   art carries its own texture, or keep a faint edge for definition.

Generate the tile and I'll wire this up, same as the robot/base/weapon sprites.
