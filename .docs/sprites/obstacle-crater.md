# Terrain fill prompt — crater floor

The **fill texture** for impassable crater terrain — the pulverised floor at the
bottom of a blast. The mountain rock in [obstacle-mountain.md](obstacle-mountain.md)
is its counterpart: same job, same rules, opposite elevation.

Read the "This is a fill, not a tile" section in
[obstacle-mountain.md](obstacle-mountain.md) first — it explains why the renderer
changed and what the art is now responsible for. Everything there applies here.

## The specific thing the old brief got wrong

The old brief forbade any circular or centered composition, because a wrap-around
tile repeated per cell would telegraph the grid. But **a crater is a centered
circular form**, so forbidding it left an asset that read as neither crater nor
mountain. The generated master then ignored the instruction and produced a
complete little bowl — which, drawn once per blocked cell, is exactly why a crater
cluster looked like a patch of dug pits.

Both halves are now resolved by moving the crater's *shape* out of the texture:

- the round depression, its inner shadow and its depth are drawn by `TerrainView`
  from the cluster's own silhouette and distance-transform depth field;
- the raised debris halo is a separate decal, [terrain-ejecta.md](terrain-ejecta.md),
  laid **outside** the footprint on passable ground;
- this file is only the material at the bottom — flat, seamless, shapeless.

So the "no circle, no centre" rule survives, but it now costs nothing.

## Spec

Identical to [obstacle-mountain.md](obstacle-mountain.md) except:

- **Darker than the ground, not lighter.** Roughly `#05070b` to `#1b2230` against
  the ground's `#0d1117` family. Rock rises and catches light, a pit sinks and
  loses it — the value relationship is half the reason the two kinds read apart.
- **A faint soot warmth is allowed** in the ash between the plates, never
  saturated and never orange. This is the one place the terrain palette is
  permitted any warmth at all.
- **No radial cracking.** Radial anything implies a centre, and the centre is
  drawn by the engine.

## Prompt

```text
A perfectly seamless, tileable top-down texture of a shattered, scorched impact-crater floor, seen from
directly overhead with no perspective.

This is a FILL TEXTURE, not a finished tile and not a crater. The crater's round shape, its rim, its
inner shadow and its depth are all drawn by the game engine on top of this texture. Therefore light it
FLATLY and EVENLY with pure ambient light from every direction at once, and draw NO circular form, NO
bowl, NO rim, NO radial cracks and NO centre. No sun, no directional lighting, no cast shadows, no
vignette, no darkening toward any edge, no baked ambient occlusion, no implied depth or slope. Every
part of the frame must look equally lit and equally deep.

Surface: pulverised bedrock at the bottom of a blast — shattered irregular rock plates tilted against
each other, packed ash and fine burnt debris filling the gaps between them, hairline heat cracks. Medium
scale structure, evenly distributed. No boulders on top, no sand dunes, no vegetation, no water, no
man-made objects.

Colour: near-black, colder and clearly DARKER than the surrounding battlefield ground (#0d1117), within
a range of about #05070b to #1b2230. At most a very faint soot-brown warmth in the ash between the
plates, never saturated, never orange. No bright highlights anywhere.

Seamless: the left edge continues into the right and the top into the bottom with no visible seam when
repeated in a grid. No centered feature, no focal point, no radial or circular composition, no single
large form that would telegraph the repeat — it should read as a random crop out of an enormous
shattered floor.

Style: clean stylized semi-flat RTS game art, subtle cel shading, very low saturation, low visual noise,
bold medium-scale forms rather than fine speckle detail. It must still read as shattered rock when shown
at roughly one third of its authored size.

Square image, 1024x1024.
```

## How it is wired up

Same chain as the mountain: master at
`client/assets-src/sprites/obstacle-crater.png` (**1024²**, opaque, seamless) →
`public/obstacle-crater.webp` at **512²** → `terrainSprites[TerrainKind.Crater]` →
the masked world `TilingSprite` in `TerrainView`. A missing texture falls back to
`palette.obstacle.crater`.

The crater is a distinct terrain kind, not a reskin:

- `TerrainKind` (`types/src/enums.ts`) — `open | mountain | crater`.
- `generateObstacles()` rolls the kind **per cluster**
  (`gameConfig.obstacles.craterChance`), never per tile, so a blob is all one kind
  — which is what lets the renderer treat a cluster as one object.
- Two boolean grids derive from it (`src/engine/obstacles.ts`): `movementGrid`
  (mountain **and** crater) and `sightGrid` (mountain **only**). Hence: **robots
  must drive around a crater but can shoot across it.**

**That difference has to be visible, and it is the rim that carries it.**
`TerrainView` draws the boundary rim inverted between the two kinds: on a mountain
the light-facing edge is bright (a wall rising toward the light), on a crater it is
dark (an inner wall turned away from it). Combined with the inverted depth shading
and the ejecta halo, a player can tell at a glance which cover they can shoot
through — so this is gameplay information, not polish.

No `Math.random()` anywhere in generation: the kind comes from the seeded match
rng, and the renderer's own variation comes from a pure hash of tile coordinates,
so lockstep peers see identical terrain.
