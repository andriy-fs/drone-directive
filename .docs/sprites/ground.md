# Ground surface tile prompt

A prompt for the **walkable ground** the robots move across — the base texture
that replaces the flat dark fill the playfield uses today (`createGrid` fills the
whole field with `palette.background` and draws grid lines on top).

The ground is the **bottom-most layer**, under the grid, obstacles, units and
projectiles, so it must be the **darkest, flattest, lowest-contrast** thing on
screen — everything else has to read on top of it. It should also look clearly
**walkable and smooth**, visually distinct from the jagged impassable rubble in
[obstacles.md](obstacles.md).

Like the obstacle tile, this is **terrain, not a unit**, so it overrides parts of
the [Shared spec](README.md): **full-bleed and opaque** (no transparent margin, no
centering) and **seamlessly tileable** (opposite edges match).

## Tile-specific spec

- **View:** strict orthographic **top-down**.
- **Bleed:** fills the **entire frame edge-to-edge** — no padding, no transparent
  border. It's a repeating background.
- **Seamless:** the **left edge matches the right, top matches bottom**
  (wrap-around tileable), with **no single focal feature** that would telegraph
  the repeat — favor an even, subtle surface.
- **Tiles across the whole field:** the field is 40×40 tiles (one tile = **32 px**).
  Author at **512×512**; it's repeated across the ~1280×1280 px field (as one
  tiling layer), so keep detail sparse — it must look calm at a distance, not busy.
- **Palette — deepest background layer:** very dark, muted, desaturated near-black
  (deep charcoal / dark blue-gray) matching the field background `#0d1117`. It
  should be **darker and flatter than the obstacle rock** so obstacles, and bright
  blue (player) / red (enemy) units and projectiles, always pop against it. Never
  the brightest or highest-contrast element.
- **Style:** clean stylized retro-futuristic RTS ground, semi-flat with very light
  cel shading, soft even top lighting, low detail, low contrast.

## Prompt

```text
A seamless, tileable top-down (bird's-eye) ground terrain texture for the walkable
battlefield of a retro-futuristic RTS, viewed from directly above. A dark, barren,
war-torn surface — packed charcoal earth and ash with faint hairline cracks,
scattered fine gravel and subtle worn scorch marks, evenly distributed with no
single focal feature. Very dark, muted, desaturated near-black palette (deep
charcoals and dark blue-grays on a #0d1117 background) so it stays firmly in the
background and bright blue and red units, projectiles and rocky obstacles clearly
read on top. Flat and smooth — clearly walkable ground, distinct from jagged
impassable rubble. Fills the entire frame edge-to-edge with no border and no
transparent margin, and is perfectly seamlessly tileable — the left edge continues
into the right and the top into the bottom with no visible seam when repeated in a
grid. Clean stylized semi-flat game art, very light cel shading, soft even top
lighting, low detail and low contrast. Square image, 512x512.
```

## Wiring the generated tile into the game

1. Export as `public/ground-tile.png` (opaque, seamless).
2. Add a `groundSprite` entry to `src/config/sprites.ts` and include its `src` in
   `spriteSources()` so it preloads; add a `getGroundTexture()` to
   `src/pixi/assets.ts` (same cached pattern as the others).
3. In `GameApp.init` (or `Grid.ts`), add a single `TilingSprite` sized to
   `worldPixelSize` on `layers.ground` **beneath the grid**, replacing the flat
   `palette.background` fill in `createGrid`. Keep the grid lines drawn on top (they
   read as a coordinate overlay) or fade/drop them once the texture carries the
   surface. Fall back to the current flat fill when the image isn't loaded.
   - `tileScale` controls repeat density: `tilePx / texture.width` gives one tile
     per grid cell; a larger value repeats over several cells for a broader, less
     obviously-tiled surface — tune to taste.

Generate the tile and I'll wire this up, same as the robot/base/weapon/obstacle
sprites.
