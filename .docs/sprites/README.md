# Sprite generation prompts

Prompts for generating unit/base art for Drone Directive, tuned
for **Gemini** and **ChatGPT** image generation. Keep these in sync when new
robot chassis or base types are added, so art can be regenerated consistently.

- **[robots.md](robots.md)** — one prompt per chassis × faction (player / enemy).
- **[drone.md](drone.md)** — the player's flying observer drone (single sprite).
- **[bases.md](bases.md)** — player base + AI (enemy) base.
- **[weapons.md](weapons.md)** — top-mounted weapon module overlays (radar, bomb
  kamikaze) × faction, rendered on the robot's central hardpoint.
- **[obstacle-mountain.md](obstacle-mountain.md)** — impassable-terrain tile (one
  32 px cell, seamlessly tileable): a **mountain** massif. Blocks movement _and_
  line of fire.
- **[obstacle-crater.md](obstacle-crater.md)** — the other impassable-terrain tile,
  same spec and palette but a collapsed impact **crater** (sinks instead of rises).
  Blocks movement but **not** line of fire — robots shoot across it. The kind is
  rolled per cluster from the seeded match rng.
- **[ground.md](ground.md)** — the walkable ground surface tile (seamless,
  full-field) that replaces the flat dark playfield fill.
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
`radar`) are **top-mounted modules**, not baked into the chassis — leave a clear
central dorsal hardpoint on each robot where the module/marker overlays it. See
[weapons.md](weapons.md) for the radar and bomb module prompts.

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

The split exists because the masters overshoot enormously — a weapon module was
authored at 500² and is drawn at 24 px. Shipping the masters cost ~4 MB on the
title screen for detail no display can resolve. See
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
   so a forgotten one cannot silently never ship.
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

- [ ] Transparent background (no white box, no shadow, no ground).
- [ ] Pointing straight up, perfectly top-down (no perspective tilt).
- [ ] Centered with padding; nothing touching the frame edge.
- [ ] Reads clearly at small size; strong silhouette.
- [ ] Correct faction palette/vibe; enemy obviously hostile.
- [ ] Clear central hardpoint left free for the weapon marker (robots).
