# Terrain decal prompt — crater ejecta

A **single ring of blast debris**, drawn once per crater cluster, scaled to that
cluster's bounding box. This is what turns a dark patch into a crater.

## Why this asset exists

A crater is read from two things: the depression itself, and the material thrown
out of it. The depression is procedural — `TerrainView` builds it from the
cluster's silhouette, an inverted boundary rim and inverted depth shading. The
ejecta cannot be: it lies **outside** the cluster footprint, on passable ground,
which no mask over the terrain can reach.

It also does a second job. The blocked footprint is a staircase of 32 px squares,
and a debris halo straddling that boundary is the cheapest honest way to soften it
— honest because ejecta genuinely is loose material on drivable ground, so nothing
about it implies the tile underneath is blocked.

## Spec

- **View:** strict orthographic **top-down**.
- **Background:** **fully transparent**, and so is the middle.
- **The centre must be an empty hole**, roughly the middle 45% of the width, fully
  transparent. The crater itself is drawn by the engine underneath. Any pit, bowl,
  rim wall or surface generated inside that hole will be visible as a wrong,
  doubled crater on top of the real one — this is the failure mode to check for
  first.
- **Fades to zero alpha well before the frame edge.** A hard outer boundary would
  put a visible circle on the ground. No outline anywhere.
- **Asymmetric.** Uneven density, uneven radial streaks, heavier on one side —
  a perfect annulus reads as a UI element, not as debris. The renderer rotates
  each instance from a hash of its cluster's coordinates, which only helps if the
  shape is irregular to begin with.
- **No lighting.** Flat ambient. No sun, no cast or drop shadow, no glow, no fire,
  no embers, no smoke, no dust cloud. It is cold debris long after the blast, not
  the blast.
- **Palette:** dark ash-gray and cold near-black with a few lighter blue-gray rock
  chips, about `#0a0e15` to `#3a4658`. It sits on the darkest layer in the game and
  must not brighten it. Faint soot-brown at most.
- **On-field scale:** shipped at 768², drawn scaled to the cluster's bounding box
  — up to roughly **400 px** on a large blob. Chunky debris shapes, not speckle.

## Prompt

```text
A single top-down ring of blast ejecta on a fully transparent background, for a stylized RTS game — the
debris thrown outward around an impact crater, seen from directly overhead.

The CENTRE OF THE IMAGE IS COMPLETELY EMPTY AND FULLY TRANSPARENT — a clear hole covering roughly the
middle 45% of the width. The crater itself is drawn by the game engine and must not appear here. Do not
draw a pit, a bowl, a rim wall, a shadow or any surface inside that hole.

Around that empty centre: an irregular, roughly circular band of ejected material — pulverised ash,
angular rock chips and small debris. Densest just outside the empty centre, thinning outward and fading
completely to zero alpha well before the frame edge, so there is no hard circular boundary anywhere. A
few faint radial streaks spray outward from the centre, uneven in length and spacing, heavier on one
side than the other so the ring is clearly asymmetric rather than a perfect annulus.

Light it FLATLY and EVENLY with ambient light from every direction. No sun, no directional lighting, no
cast shadows, no drop shadows, no glow, no fire, no embers, no smoke, no dust cloud, no outline.

Colour: dark ash-gray and cold near-black scattered material with a few slightly lighter blue-gray rock
chips, within a range of about #0a0e15 to #3a4658. Muted and dark so it stays in the background. At most
a very faint soot-brown tint in the ash, never orange, never saturated.

Style: clean stylized semi-flat RTS game art, low saturation, low visual noise, readable chunky debris
shapes rather than fine speckle. Must read as thrown debris when scaled to roughly 400 screen pixels
across.

Square image, 1024x1024, transparent PNG.
```

## How it is wired up

1. Master at `client/assets-src/sprites/terrain-ejecta.png` — **1024²**,
   transparent PNG.
2. `scripts/encode-sprites.mjs` ships it as `public/terrain-ejecta.webp` at
   **768²** (`alpha: true`, not `seamless`). Larger than the other decals because
   it is the one asset stretched to several hundred pixels on screen.
3. `ejectaSprite` in `src/config/sprites.ts`, `src` in `spriteSources()`.
4. `TerrainView` draws one per crater cluster, centred on the cluster, scaled to
   its bounding box, rotated from a hash of the cluster's origin — **below** the
   terrain fill in the layer order, so the fill always wins where the two overlap
   and the blocked footprint stays exactly what it is.

**Optional by design.** A missing file resolves to `null` and craters simply draw
without a halo; the depression itself is procedural and unaffected.
