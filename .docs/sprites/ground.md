# Ground surface prompts

The **walkable ground** the robots move across — the bottom-most thing drawn,
under terrain, units and projectiles. Two seamless variants blended together, plus
a separate decal sheet ([ground-decals.md](ground-decals.md)).

## Why there are two of them now

The old brief asked for a single tile with "an even, subtle surface" and "no
single focal feature". That instruction is correct for hiding a *seam* and
disastrous for hiding a *period*: one uniform texture repeated across a 1280–2560 px
field is uniform everywhere, so the repeat is read from the overall rhythm even
though no seam is visible. The result was a field that looked flat and machine-made.

Three changes fix it, and only the first two need art:

1. **Large-scale variation is now required inside each tile**, not forbidden —
   broad, low-contrast, soft-edged drifts of tone. Contrast stays low; what
   changes is that it is no longer *homogeneous*.
2. **A second variant** (`ground-tile-alt`) with a different surface character —
   cracked hardpan against tile A's packed grit — blended over the first through a
   low-frequency noise mask generated in code. Two periods with different phases
   and a soft mask between them do not read as either.
3. **Decals** scattered over both ([ground-decals.md](ground-decals.md)).

The repeat itself also got longer: masters are **2048²**, shipped at **1024²**, and
`GROUND_REPEAT_TILES` is **8**, so one repeat covers 256 px of field instead of 128.

## Spec (both variants)

- **View:** strict orthographic **top-down**.
- **Bleed:** opaque, edge-to-edge, no border, no transparent margin.
- **Seamless:** left matches right, top matches bottom.
- **Darkest and flattest thing on screen.** Everything else has to read on top of
  it. It must also look obviously *drivable* — smooth and flat, clearly distinct
  from the fractured rock of [obstacle-mountain.md](obstacle-mountain.md).
- **No lighting**, for the same reason as the terrain fills: flat even ambient, no
  sun, no cast shadows, no vignette, no edge darkening.
- **Nothing standing proud of the surface** — no boulders, no craters, no roads,
  no tracks, no man-made objects. Those are decals, and keeping them out of the
  base texture is what stops a recognisable object from repeating every 256 px.
- **Palette:** `#0b0f16`–`#212832`, anchored on the `#0d1117` field background.
  Slightly **warmer and more neutral** than the cold blue-gray rock above it, so
  ground and terrain read as different materials rather than the same one at two
  brightnesses.
- **On-field scale:** shipped 1024² repeating every 256 px — a 4× downscale.

## Prompt — variant A (`ground-tile.png`)

```text
A perfectly seamless, tileable top-down ground texture for the walkable battlefield of a retro-futuristic
RTS, seen from directly overhead with no perspective.

This is the bottom-most layer of the whole game and must stay the darkest, flattest and lowest-contrast
thing on screen — bright blue and red units, projectiles and the rocky terrain above it all have to read
clearly on top. It must also look obviously flat, smooth and drivable, clearly distinct from fractured
impassable rock.

Surface: dark packed charcoal earth and ash, worn flat. Fine grit and small pressed-in gravel, faint
hairline cracks, and BROAD SOFT PATCHES of slightly differing tone across the frame — drifts of paler
ash, darker damp earth, faint worn scorch — so that the texture varies at a large scale instead of
reading as uniform noise. These patches must be low-contrast and gradual, with soft edges, never sharp
shapes, never a focal point, and never one dominant form that would telegraph the repeat when tiled.

Light it FLATLY and EVENLY with ambient light from every direction. No sun, no directional lighting, no
cast shadows, no vignette, no darkening toward any edge. No rocks standing proud of the surface, no
boulders, no craters, no vegetation, no water, no roads, no man-made objects, no tracks — those are
added separately as decals.

Colour: very dark, muted, desaturated near-black — deep neutral charcoals and dark blue-grays anchored
on the #0d1117 field background, within a range of about #0b0f16 to #212832. Slightly warmer and more
neutral than the cold blue-gray rock that sits on top of it, so the two read as different materials.
No bright highlights, no saturated colour anywhere.

Seamless: the left edge continues into the right and the top into the bottom with no visible seam when
repeated in a grid.

Style: clean stylized semi-flat RTS game art, very light cel shading, low detail, low contrast, calm at
a distance rather than busy. It must still read as packed ground at roughly one quarter of its authored
size.

Square image, 2048x2048.
```

## Prompt — variant B (`ground-tile-alt.png`)

Same prompt as variant A, with **only the "Surface:" paragraph replaced**. Keep the
lighting, colour, seamlessness, style and size paragraphs identical — the two
variants must be interchangeable in palette, or the blend mask becomes visible as
a tonal boundary rather than a change of ground.

```text
Surface: dry cracked hardpan — a wide network of shallow, irregular polygonal cracks in baked dark clay,
with drifts of fine pale ash settled into the cracks and thin windblown streaks across the plates
between them. Flat and drivable, not raised, not broken up into loose pieces. The crack network must be
even and non-directional at a large scale, with no focal point and no single dominant crack that would
telegraph the repeat when tiled.
```

## How it is wired up

1. Masters at `client/assets-src/sprites/ground-tile.png` and
   `ground-tile-alt.png` — 2048², opaque, seamless.
2. `scripts/encode-sprites.mjs` ships both as `public/*.webp` at **1024²**
   (`alpha: false, seamless: true`; the encoder wrap-pads 3×3 before scaling so the
   wrap survives).
3. `groundSprite` / `groundAltSprite` in `src/config/sprites.ts`, both in
   `spriteSources()`.
4. `createGround()` in `src/pixi/Grid.ts` builds, on `layers.ground`:
   - variant A as a `TilingSprite` sized to `worldPixelSize`;
   - variant B as a second `TilingSprite` over it, masked by a **procedural
     low-frequency noise texture** (a small texture generated from the same pure
     hash the terrain renderer uses, scaled up with linear filtering into
     soft patches hundreds of pixels wide);
   - the decals from [ground-decals.md](ground-decals.md), placed on `Open` tiles
     outside every base's clear margin.

   It takes the match's `TerrainGrid` for that last step, and is rebuilt per match
   by `GameApp.rebuildGround()`. Variant A missing → the flat `palette.background`
   fill; variant B or the decals missing → they are simply skipped.

- `GROUND_REPEAT_TILES` (**8**) sets how many cells one repeat covers via
  `tileScale`. `1` gives one repeat per cell and looks like graph paper; large
  values stretch the art until its detail rivals unit size. Purely visual — change
  it freely, no re-export needed. **Keep this doc and the constant in step**; they
  drifted apart once already.

There are no grid lines: the texture carries the surface on its own, so
`createGrid()` and `palette.grid` are gone.
