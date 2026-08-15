# Sprite generation prompts

Prompts for generating unit/base art for Drone Directive, tuned
for **Gemini** and **ChatGPT** image generation. Keep these in sync when new
robot chassis or base types are added, so art can be regenerated consistently.

- **[robots.md](robots.md)** — one prompt per chassis × faction (player / enemy).
- **[drone.md](drone.md)** — the player's flying observer drone (single sprite).
- **[bases.md](bases.md)** — player base + AI (enemy) base.
- **[weapons.md](weapons.md)** — top-mounted weapon module overlays (cannon,
  missiles, bomb kamikaze, radar, EW jammer, DEW emitter, FPV carrier) × faction,
  rendered on the robot's central hardpoint at 30 px. **Modules do not follow the
  faction palette below** — they carry a per-weapon colour code instead; see the
  two rules at the top of that file before regenerating any of them.
- **[obstacle-mountain.md](obstacle-mountain.md)** — the **fill texture** for
  impassable mountain terrain. Blocks movement _and_ line of fire.
- **[obstacle-crater.md](obstacle-crater.md)** — the fill texture for the other
  impassable kind, a collapsed impact **crater** (sinks instead of rises). Blocks
  movement but **not** line of fire — robots shoot across it. The kind is rolled
  per cluster from the seeded match rng.
- **[terrain-peaks.md](terrain-peaks.md)** — 2×2 sheet of ridge/summit decals laid
  at the interior high points of a mountain cluster.
- **[terrain-ejecta.md](terrain-ejecta.md)** — the debris halo drawn around a
  crater cluster, outside its footprint.
- **[ground.md](ground.md)** — the walkable ground surface: two seamless variants
  blended together across the whole field.
- **[ground-decals.md](ground-decals.md)** — 2×2 sheet of marks scattered over the
  ground (tracks, scrap, concrete, burn scar).

### Terrain art is not tile art — read this before regenerating any of it

Terrain used to be drawn **one sprite per blocked 32 px cell**, so each asset was a
finished, self-contained, wrap-around tile with its lighting baked in. That is what
made a cluster read as a grid of identical pictures rather than as a landform, and
it is gone. `src/pixi/render/terrain/TerrainView.ts` now draws **one masked
`TilingSprite` per terrain kind across the whole world** and derives the landform
procedurally from each cluster's own silhouette — cast shadow, boundary rim,
distance-transform depth.

The consequence for the art is a hard rule with one exception:

- **Fills** (`obstacle-mountain`, `obstacle-crater`, both ground variants) carry
  **no light whatsoever** — no sun, no shadow, no vignette, no implied edge or
  slope. They supply material; the engine supplies form. Baked light gets a second
  lighting pass on top of it and the cluster falls apart.
- **`terrain-peaks` is the exception**: it *is* the lit form, so its light is baked
  and must match the engine's global light vector — **from the upper left**. Even
  there, a **cast** shadow is still forbidden; the engine draws that from the
  silhouette.

The old briefs also forbade centered composition and directional light in order to
protect wrap-tiling, which is why the crater ended up unable to look like a crater.
Those bans are lifted where they were paying for a constraint that no longer
exists — see the top of each file.
- **[menu-backdrop.md](menu-backdrop.md)** — the title-screen splash art shown
  behind the main menu before a match starts. **Key art, not a game object:**
  cinematic three-quarter view, 16:9, opaque — it keeps the palette and faction
  language below but overrides the top-down/square/transparent rules.

## What exists today (regenerate against this list)

Robots are keyed by **chassis** (`types/src/enums.ts` → `ChassisType`); weapons
are drawn as a small marker _on top_ of the chassis by the engine, so a sprite is
**per chassis, not per weapon**:

| Chassis  | Role             | Feel                            |
| -------- | ---------------- | ------------------------------- |
| `tracks` | heavy / tanky    | slow, armored, treads           |
| `wheels` | fast / light     | quick buggy/APC, wheels         |
| `legs`   | walker / bruiser | tall articulated mech, imposing |

Bases: one per side (`player`, `ai`). Weapons (`cannon`, `missiles`, `bomb`,
`radar`, `ew`, `dew`, `fpv`) are **top-mounted modules**, not baked into the
chassis — leave a clear central dorsal hardpoint on each robot where the
module/marker overlays it. See [weapons.md](weapons.md) for a prompt pair per
module.

When a new chassis/base is added: copy the closest prompt block, swap the
silhouette description, keep every "Shared spec" rule below identical.

## Shared spec (applies to EVERY prompt — do not vary)

- **View:** strict orthographic **top-down** (bird's-eye), unit dead-centered.
- **Facing:** the unit points **straight up (north)**. This matches the engine's
  `rotationOffset: Math.PI / 2` — do not draw it facing any other direction.
- **Background:** **fully transparent** (alpha). No ground, no baked drop shadow,
  no scenery, no text, no watermark, no border. (The engine draws its own
  team-colored disc _under_ the sprite, so a baked shadow would clash.)
- **Canvas:** **512×512 px**, transparent PNG. Unit fills ~80% of the frame with
  even padding on all sides so it never clips when rotated in-game.
- **Silhouette:** bold, chunky, instantly readable at ~46 px on screen. Strong
  outline, high contrast, minimal fine detail that would blur when downscaled.
  **The camera has no zoom**, so the on-field size is not a starting point — it is
  the only size the art is ever seen at, and the composition is built against it.
  Downscaling averages: a region packed with fine detail does not get subtle, it
  collapses to a flat mean colour and drains contrast from its neighbours. Weapon
  modules, drawn at 30 px, are where this bites hardest and
  [weapons.md](weapons.md) turns it into a hard detail budget.
- **Lighting:** soft, even, from directly above; subtle rim light on top edges.
- **Style:** clean stylized retro-futuristic RTS/mecha game art, semi-flat with
  light cel shading — not photoreal, not pixel-art, not cartoonish.
- **One unit per image**, no variations grid, no labels.

## Faction visual language (this is how enemies "look different")

The engine tints a translucent disc under each unit (player = blue, AI = red),
but that alone is subtle. Make the two factions read as **clearly different armies**
at a glance, even before the tint:

|          | **Player (allied)**                                      | **Enemy (AI / hostile)**                         |
| -------- | -------------------------------------------------------- | ------------------------------------------------ |
| Palette  | cool **blues & teal**, brushed steel, white/cyan accents | hostile **reds & orange**, gunmetal, black       |
| Shapes   | sleek, rounded-armored, clean panel lines                | aggressive, **angular & spiked**, heavy plating  |
| Wear     | pristine, well-maintained                                | **rust, scorch marks, hazard stripes**           |
| Insignia | hexagon / chevron badge, cyan glow optics                | jagged emblem, single **menacing red optic/eye** |
| Vibe     | protective, high-tech                                    | brutal, scavenged war-machine                    |

### Exception: weapon modules take a role colour, not a faction colour

**The `Palette` row above applies to chassis, bases and flyers — not to the weapon
modules in [weapons.md](weapons.md).** Those are neutral dark gunmetal on both
sides and carry the colour of the *weapon* (brass cannon, plum jammer, ice-white
emitter…), identical hex for player and enemy. Faction still reads on a module,
but through the other three rows: **shape** (clean and rounded vs angular and
chipped) and **wear** (pristine vs rust and soot).

This is deliberate and it is the thing most likely to be undone by accident. A
module is 30 px; the one property that survives that downscale intact is mean
colour, and there is only one of it to spend. Spending it on the faction — which
the chassis underneath already states, in a bigger and better-lit shape — left all
seven weapons looking the same, which is exactly the bug this exception exists to
fix. Do not "restore consistency" here.

## Where the files live: masters vs. what ships

**`client/public/` holds no PNGs any more, and nothing there is hand-edited.**
The generated art is committed twice, in two different roles:

- **`client/assets-src/sprites/*.png`** — the masters, at whatever size they came
  out of the generator. In the repository, outside `public/`, so they never reach
  a build. This is the only copy worth editing or regenerating.
- **`client/public/*.webp`** — what the game downloads: each master scaled to
  roughly 2–3× its on-field size and encoded as WebP by
  **`client/scripts/encode-sprites.mjs`**. Committed, generated, ~96% smaller than
  the masters (4.0 MB → 163 KB across the 18 sprites).

The split exists because the masters overshoot enormously — a weapon module is
authored at 512² and drawn at 30 px. Shipping the masters cost ~4 MB on the title
screen for detail no display can resolve. See
`.docs/tasks/asset-loading-first-paint.md`.

## Wiring generated art into the game

1. Export each as a transparent PNG into **`client/assets-src/sprites/`** (not
   `public/`). Any resolution is fine; the encoder scales it down.
2. Naming convention: `robot-<chassis>-<faction>.png`, `base-<faction>.png`
   (e.g. `robot-wheels-ai.png`, `base-player.png`).
3. Add an entry to the `SPRITES` table in `client/scripts/encode-sprites.mjs`
   (name, encoded size, quality; `alpha: false` / `seamless: true` for opaque or
   tiling terrain), then run `node scripts/encode-sprites.mjs` from `client/` and
   commit the `.webp` it writes. The script fails loudly if a master has no entry,
   so a forgotten one cannot silently never ship. It also takes **name filters** —
   `node scripts/encode-sprites.mjs radar cannon` encodes only the matching
   masters, which is what you want when regenerating art piece by piece: a full run
   rewrites every `.webp` from masters that never changed.
4. Register in `src/config/sprites.ts` (`robotSprites`) as a **whole-image** entry
   — `src` only, **no `frame`** crop, and note the **`.webp`** extension:
   ```ts
   wheels: { src: '/robot-wheels-player.webp', rotationOffset: Math.PI / 2, targetSize: 46 }
   ```
   Bases use `targetSize` ≈ 96 (3 tiles × 32 px). Tracks currently ships as a
   cropped reference sheet (`frame`); replacing it with a clean whole-image master
   means deleting its `frame`.
5. **Per-faction art is already wired:** `robotSprites` and `weaponSprites` key on
   `owner → chassis` / `owner → weapon`, and `baseSprites` on `owner`. Only two art
   sets exist (player and opponent); every side past the first opponent reuses the
   opponent art and is told apart by the team tint (`artOwner` in `pixi/assets.ts`),
   so both faction variants always have to be generated.

## Per-image checklist before accepting a generation

### Terrain and ground

- [ ] **Fills carry no light**: no sun, no cast or drop shadow, no vignette, no
      edge darkening, no implied slope, edge or elevation anywhere in the frame.
- [ ] **Fills are seamless**: check by offsetting the image half a tile and looking
      for a cross-shaped seam.
- [ ] **Fills have no dominant form** — nothing large enough to be recognised twice
      when the texture repeats.
- [ ] **Values are right in grayscale**: rock a step lighter than the ground, crater
      floor clearly darker. If the three are indistinguishable in grayscale, the
      generation failed regardless of how it looks in colour.
- [ ] **Sheets (2×2)**: nothing touches a quadrant border — `frame` crops on the
      quadrant and will slice anything on the line.
- [ ] **Decals and peaks**: genuinely transparent background, outer edges feathered
      to zero alpha, no baked cast shadow, nothing that looks raised off the ground
      (except the peaks, which are the only thing that should).
- [ ] Crater ejecta: the middle really is an empty hole — no bowl generated inside it.

### Units, bases and modules

- [ ] Transparent background (no white box, no shadow, no ground).
- [ ] Pointing straight up, perfectly top-down (no perspective tilt).
- [ ] Centered with padding; nothing touching the frame edge.
- [ ] Reads clearly at small size; strong silhouette.
- [ ] Correct faction palette/vibe; enemy obviously hostile.
- [ ] Clear central hardpoint left free for the weapon marker (robots).
