# Ground surface tile prompt

A prompt for the **walkable ground** the robots move across — the base texture
that carries the playfield surface (it replaced a flat `palette.background` fill
plus a coordinate grid overlay, both now gone).

The ground is the **bottom-most layer**, under obstacles, units and projectiles,
so it must be the **darkest, flattest, lowest-contrast** thing on screen —
everything else has to read on top of it. It should also look clearly
**walkable and smooth**, visually distinct from the jagged impassable rubble in
[obstacle-mountain.md](obstacle-mountain.md).

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
- **Tiles across the whole field:** one grid cell is **32 px**; maps are 40/60/80
  cells square (1280–2560 px). Author at **1024×1024** — the shipped tile's size.
  It is drawn scaled down: `GROUND_REPEAT_TILES` (currently **8**) sets how many
  cells one repeat covers, so 1024 px of art renders as 256 px on the field, a 4×
  downscale. Author detail accordingly — fine gravel must still read as gravel next
  to a 32 px robot, and the surface must look calm at a distance, not busy.
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
lighting, low detail and low contrast. Square image, 1024x1024.
```

## How the tile is wired up

Already done — this is the shape of it, for when the tile gets regenerated.

1. Exported as `public/ground-tile.png` (opaque, seamless, 1024×1024).
2. `groundSprite` in `src/config/sprites.ts` (its `src` is in `spriteSources()` so
   it preloads) and `getGroundTexture()` in `src/pixi/assets.ts` (same cached
   pattern as the other sprites).
3. `createGround()` in `src/pixi/Grid.ts` builds one `TilingSprite` sized to
   `worldPixelSize` on `layers.ground`, added in `GameApp.init` and rebuilt per
   match by `rebuildGround()`. It falls back to the flat `palette.background` fill
   when the image isn't loaded.
   - `GROUND_REPEAT_TILES` controls repeat density via `tileScale`: `1` gives one
     repeat per grid cell (visibly regular), large values stretch the art until its
     detail rivals unit size and the texture barely repeats across the map. **8** is
     the tuned middle. Purely visual — change it freely, no re-export needed.

There are no grid lines any more: the texture carries the surface on its own, so
`createGrid()` and `palette.grid` were removed.
