# Ground decal prompt

A **2×2 sheet of four ground decals**, scattered over the walkable surface at match
start. The third leg of the ground look, after the two base variants in
[ground.md](ground.md).

## Why this asset exists

The base ground textures are deliberately featureless: anything recognisable baked
into a tile that repeats every 256 px becomes the thing that *proves* the repeat.
Decals are how recognisable objects get onto the field without a period — placed
individually, at hashed positions, with hashed rotation, scale and variant.

They are also the cheapest variety in the whole plan. Four shapes on one sheet
batch into a single draw call and change the character of the field more than any
change to the tiles themselves.

## Spec

- **View:** strict orthographic **top-down**. Everything lies flat on the ground.
- **Layout:** four decals, one per 512² quadrant of a 1024² frame. Nothing may
  touch a quadrant border — the game crops each quadrant with `SpriteDef.frame`.
- **Background:** **fully transparent.** No frame, no separators, no labels.
- **Edges: feathered** to zero alpha. A hard cut-off reads as a sticker laid on
  the ground rather than a mark in it.
- **No lighting and no elevation.** Flat ambient, no sun, no cast or drop shadow,
  no glow, no fire, no smoke, no outline. Nothing may look like it stands up —
  these lie *in* the surface, and the only things in the game that cast shadows are
  mountain clusters.
- **Four decals:**
  1. parallel vehicle track ruts pressed into dirt, running straight across, with
     churned edges;
  2. a loose scatter of scrap and rubble — twisted metal, broken plating, rock
     chips — never a neat pile;
  3. a fragment of broken concrete roadway or landing pad, cracked and crumbled at
     the edges, faint worn markings;
  4. an old burn scar, soft and irregular, darkest at the centre, fading outward.
- **Palette:** the ground's own — `#0a0e15` to `#2b3340`. The concrete slab may
  reach about `#3a4250` as the lightest element in the set; it is the one decal
  allowed to read as a different material. No rust orange, no hazard yellow, no
  saturated colour — those belong to units and to UI state, and a permanent mark on
  the ground must never wear the colour of a passing event.
- **On-field scale:** shipped at 512² (each quadrant 256²), drawn at roughly
  **160 px** — about 5 tiles. Chunky readable shapes, no fine detail.

## Prompt

```text
A 2x2 grid of four separate top-down ground decals on a fully transparent background, for a stylized RTS
game. One decal per quadrant, each roughly filling its own 512x512 quadrant, never overlapping its
neighbours. No frame, no separator lines, no labels, no background of any kind — pure alpha between and
around the shapes.

The four decals: (1) a set of parallel vehicle track ruts pressed into dirt, running straight across the
quadrant, with churned edges; (2) a scattered field of small scrap and rubble — twisted metal fragments,
broken plating, rock chips — loosely distributed, never a neat pile; (3) a fragment of broken concrete
roadway or landing pad, a slab with cracked and crumbled edges and faint worn markings; (4) an old burn
scar, a soft irregular scorched patch, darkest at its centre and fading outward.

All four lie FLAT on the ground and are seen from directly overhead. Light them FLATLY and EVENLY with
ambient light from every direction: no sun, no directional lighting, no cast shadows, no drop shadows,
no glow, no fire, no smoke, no outline, no elevation. Nothing may look like it stands up off the ground.

Every decal FADES SOFTLY to zero alpha at its outer edges rather than being cut off hard, so it can be
laid over the ground texture without reading as a sticker.

Colour: the same very dark, muted, desaturated near-black palette as the battlefield ground — deep
charcoals and dark blue-grays within about #0a0e15 to #2b3340, with the concrete slab allowed to reach
about #3a4250 as the lightest element in the set. No bright highlights, no saturated colour, no rust
orange, no hazard yellow.

Style: clean stylized semi-flat RTS game art, low saturation, low contrast, chunky readable shapes
rather than fine detail. Each decal must read at roughly 150 screen pixels.

Square image, 1024x1024, transparent PNG.
```

## How it is wired up

1. Master at `client/assets-src/sprites/ground-decals.png` — 1024², transparent PNG.
2. Shipped as `public/ground-decals.webp` at **512²** (`alpha: true`, not seamless).
3. `groundDecalSprites` in `src/config/sprites.ts` — four entries sharing one
   `src`, each with a 256×256 `frame` crop, plus `targetSize`.
4. `createGround()` places them: candidate positions come from a pure hash of tile
   coordinates on a coarse stride, rejected on any non-`Open` tile and inside every
   base's clear margin (the same protected region `generateObstacles` keeps free,
   read from `gameConfig.obstacles.baseClearMargin` and `gameConfig.bases` rather
   than duplicated). Variant, rotation and scale come from the same hash, so every
   peer draws the identical field without touching the engine's seeded `Rng`.

**Optional by design.** A missing file resolves to `null` and the ground simply
draws without decals.

**Reused later.** The dynamic battle-scarring feature (scorch marks left where
things die) is scoped separately, and decal 4 is the mark it will stamp — so the
burn scar is worth generating well even though nothing places it dynamically yet.
