# Base sprite prompts

One prompt per faction. A base occupies a **3×3 tile footprint (96×96 px on
field)**, so it's a chunky **square-ish** top-down structure — not a vehicle. It
does not move or rotate, so orientation is free (design it to read from above
with no single "front"). Everything else follows the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary).

Reminder baked into each prompt: **top-down, transparent background, 512×512,
centered, one structure, square footprint, no rotation needed.**

---

## Player base — `base-player.png`

```text
Top-down (bird's-eye) game sprite of an allied command base / robot factory for a
retro-futuristic RTS, viewed from directly above. A chunky fortified square
building footprint with a central production bay or launch pad, surrounded by
armored walls, antenna masts, landing lights and cooling vents. Sleek allied
faction design: cool blue and teal armor panels with brushed-steel trim, glowing
cyan accent strips and a hexagon chevron emblem on the roof. Reads clearly as a
friendly headquarters. Bold readable silhouette, semi-flat stylized art with
light cel shading, soft even top lighting. Fully transparent background, no
surrounding terrain, no shadow, no text. Centered as a roughly square structure
filling about 85% of a 512x512 frame with even padding.
```

## Enemy base — `base-ai.png`

```text
Top-down (bird's-eye) game sprite of a hostile enemy command base / war factory
for a retro-futuristic RTS, viewed from directly above. A chunky brutal square
fortress footprint with a central production bay or launch pad, surrounded by
spiked armored walls, jagged antenna masts, smokestacks and glowing red vents.
Hostile enemy faction design: aggressive angular gunmetal-and-dark plating with
red and orange panels, rust streaks, scorch marks, yellow-black hazard stripes,
a menacing red optic/beacon and a jagged emblem on the roof. Reads clearly as a
dangerous enemy stronghold. Bold readable silhouette, semi-flat stylized art with
light cel shading, soft even top lighting. Fully transparent background, no
surrounding terrain, no shadow, no text. Centered as a roughly square structure
filling about 85% of a 512x512 frame with even padding.
```

---

### Wiring note

Bases render at ~96 px (`targetSize: 96`, 3 tiles × 32 px). Like robots, the
engine tints a team-colored fill under `BaseView` today; using these distinct
per-faction base sprites needs `BaseView` to select art by `owner` (see
[README → Wiring](README.md#wiring-generated-art-into-the-game)). Keep the two
bases visually parallel in scale and detail so they feel like the same game.
