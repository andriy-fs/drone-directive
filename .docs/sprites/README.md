# Sprite generation prompts

Prompts for generating unit/base art for the Drone Directive web remake, tuned
for **Gemini** and **ChatGPT** image generation. Keep these in sync when new
robot chassis or base types are added, so art can be regenerated consistently.

- **[robots.md](robots.md)** — one prompt per chassis × faction (player / enemy).
- **[drone.md](drone.md)** — the player's flying observer drone (single sprite).
- **[bases.md](bases.md)** — player base + AI (enemy) base.
- **[weapons.md](weapons.md)** — top-mounted weapon module overlays (radar, bomb
  kamikaze) × faction, rendered on the robot's central hardpoint.
- **[obstacles.md](obstacles.md)** — the impassable-terrain tile (one 32 px cell,
  seamlessly tileable) that replaces the flat gray obstacle cells.
- **[ground.md](ground.md)** — the walkable ground surface tile (seamless,
  full-field) that replaces the flat dark playfield fill.

## What exists today (regenerate against this list)

Robots are keyed by **chassis** (`src/types/enums.ts` → `ChassisType`); weapons
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

## Wiring generated art into the game

1. Export each as a transparent PNG and drop it in `public/`.
2. Naming convention: `robot-<chassis>-<faction>.png`, `base-<faction>.png`
   (e.g. `robot-wheels-ai.png`, `base-player.png`).
3. Register in `src/config/sprites.ts` (`robotSprites`) as a **whole-image** entry
   — `src` only, **no `frame`** crop:
   ```ts
   wheels: { src: '/robot-wheels-player.png', rotationOffset: Math.PI / 2, targetSize: 46 }
   ```
   Bases use `targetSize` ≈ 96 (3 tiles × 32 px). Tracks currently ships as a
   cropped reference sheet (`frame`); replacing it with a clean whole-image PNG
   means deleting its `frame`.
4. **Note — per-faction sprites need a small code change:** `robotSprites` is keyed
   by chassis only today (team difference = the tint disc). To actually show the
   distinct _enemy_ art, extend the lookup to key on `owner + chassis` (and the same
   for bases in `BaseView`). Generate both faction variants now; wire the owner
   dimension when that lookup is added.

## Per-image checklist before accepting a generation

- [ ] Transparent background (no white box, no shadow, no ground).
- [ ] Pointing straight up, perfectly top-down (no perspective tilt).
- [ ] Centered with padding; nothing touching the frame edge.
- [ ] Reads clearly at small size; strong silhouette.
- [ ] Correct faction palette/vibe; enemy obviously hostile.
- [ ] Clear central hardpoint left free for the weapon marker (robots).
