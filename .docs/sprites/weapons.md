# Weapon module sprite prompts

Weapons are **top-mounted modules** rendered on the robot's central hardpoint —
the flat circular mount the [robot prompts](robots.md) deliberately leave empty —
**over any chassis**. So a weapon needs **one small module sprite per faction**,
not a full robot per chassis×weapon combination. This matches how the engine
draws weapons today (a marker on top of the chassis) and scales cleanly as
weapons are added.

Covered here: **radar**, **bomb (kamikaze)** and **DEW (directed-energy weapon)** —
the weapons without art yet (`cannon`/`missiles` currently use simple drawn markers;
add them the same way if you want sprite parity). The full weapon list is
`types/src/enums.ts` → `WeaponType`.

## Module-specific spec (in addition to the [Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary))

- **It's a small module, not a whole robot.** Design just the weapon device on a
  compact armored mount plate — it sits on the center of a robot ~46 px wide, so
  the module reads at roughly **half that size**.
- **Fill:** the module fills ~**65%** of the frame (more padding than robots) so
  it visually reads as a part bolted onto the hull, centered in a 512×512
  transparent PNG.
- **Rotation-friendly:** make it roughly **radially balanced / readable from any
  angle** — the module may inherit the robot's heading rotation, so avoid a
  strong single "front."
- **Faction palette** follows the same
  [faction language](README.md#faction-visual-language-this-is-how-enemies-look-different)
  as robots (player = blue/teal/clean, enemy = red/gunmetal/aggressive), so a
  module matches the chassis it mounts on.

Reminder baked into each prompt: **top-down, transparent background, 512×512,
centered small module, no baked shadow.**

---

## Radar — spotter module (no weapon; doubles detection range)

### Player (allied) — `weapon-radar-player.png`

```text
Top-down (bird's-eye) game sprite of a compact radar / sensor module that bolts
onto the central hardpoint of a combat robot, viewed from directly above. A small
armored mount plate carrying a shallow dish and a fine rotating scanner antenna.
Allied faction design: cool blue and teal with brushed steel, a glowing cyan dish
face and a soft cyan sweep glow. No barrel, no projectile weapon — clearly a
sensor, not a gun. Radially balanced so it reads from any angle. Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting.
Fully transparent background, no ground, no shadow, no text. Centered, the module
filling about 65% of a 512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-radar-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact radar / sensor module that bolts
onto the central hardpoint of a combat robot, viewed from directly above. A small
jagged armored mount plate carrying a battered dish and a spiky scanner antenna.
Hostile enemy faction design: gunmetal and dark plating with red and orange
accents, rust streaks and a menacing glowing red dish face. No barrel, no
projectile weapon — clearly a sinister sensor, not a gun. Radially balanced so it
reads from any angle. Bold readable silhouette, semi-flat stylized art with light
cel shading, soft top lighting. Fully transparent background, no ground, no
shadow, no text. Centered, the module filling about 65% of a 512x512 frame with
generous even padding.
```

---

## Bomb — kamikaze payload module (detonates on contact)

### Player (allied) — `weapon-bomb-player.png`

```text
Top-down (bird's-eye) game sprite of an explosive kamikaze payload module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A
rounded armored warhead / bomb casing on a small mount plate, unmistakably an
explosive. Allied faction design: cool blue and teal steel casing, but with
clear danger cues — a blinking red arming light and yellow-and-black hazard
chevrons around the warhead. Radially balanced, no single front. Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting.
Fully transparent background, no ground, no shadow, no text. Centered, the module
filling about 65% of a 512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-bomb-ai.png`

```text
Top-down (bird's-eye) game sprite of an explosive kamikaze payload module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A
crude, menacing armored warhead / bomb casing on a jagged mount plate. Hostile
enemy faction design: dark gunmetal casing with red and orange plating, rust,
scorch marks, a jagged skull-like emblem, a glaring red arming light and
yellow-and-black hazard stripes around the warhead. Radially balanced, no single
front. Bold readable silhouette, semi-flat stylized art with light cel shading,
soft top lighting. Fully transparent background, no ground, no shadow, no text.
Centered, the module filling about 65% of a 512x512 frame with generous even
padding.
```

---

## DEW — directed-energy emitter module (no damage; disables the target)

The directed-energy weapon induces high-voltage currents in the target and knocks its
electrics and electronics out for 8 seconds — see `.docs/tasks/weapon-dew.md`. It must
read as an **energy emitter, not a gun**: coils and arcs, no barrel and no shell, so a
player can tell at a glance that this unit disables rather than kills. Keep it clearly
distinct from the `ew` jammer module (which is an antenna mast, not a coil).

### Player (allied) — `weapon-dew-player.png`

```text
Top-down (bird's-eye) game sprite of a compact directed-energy weapon (DEW) emitter
module that bolts onto the central hardpoint of a combat robot, viewed from directly
above. A small armored mount plate carrying a ring of copper induction coils around a
central Tesla-style high-voltage electrode, with thin blue-white arcs of electricity
crackling between the coil tips. Allied faction design: cool blue and teal plating with
brushed steel and copper coil windings, a glowing cyan-white core. No barrel, no shell,
no explosive — clearly an energy emitter, not a gun. Radially balanced so it reads from
any angle. Bold readable silhouette, semi-flat stylized art with light cel shading, soft
top lighting. Fully transparent background, no ground, no shadow, no text. Centered, the
module filling about 65% of a 512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-dew-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact directed-energy weapon (DEW) emitter
module that bolts onto the central hardpoint of a combat robot, viewed from directly
above. A jagged armored mount plate carrying a crude ring of scorched copper induction
coils around a central spiked high-voltage electrode, with violent violet-white arcs of
electricity lashing between the coil tips. Hostile enemy faction design: dark gunmetal
and red-orange plating, rust streaks and burn marks, a glaring magenta-white core. No
barrel, no shell, no explosive — clearly a sinister energy emitter, not a gun. Radially
balanced so it reads from any angle. Bold readable silhouette, semi-flat stylized art
with light cel shading, soft top lighting. Fully transparent background, no ground, no
shadow, no text. Centered, the module filling about 65% of a 512x512 frame with generous
even padding.
```

---

## Wiring generated weapon modules into the game

The plumbing already exists — `weaponSprites` in `client/src/config/sprites.ts`,
`getWeaponTexture()` in `client/src/pixi/assets.ts`, and the hardpoint child sprite in
`RobotView` (which falls back to the drawn Graphics marker when a weapon has no art).
So adding a module is two steps:

1. Export transparent PNGs to `client/public/`, named `weapon-<type>-<faction>.png`
   (e.g. `weapon-radar-ai.png`, `weapon-dew-player.png`).
2. Add the pair to `weaponSprites`, keyed `owner → weapon`, using the shared
   `WEAPON_TARGET` size:
   ```ts
   player: { dew: { src: '/weapon-dew-player.png', targetSize: WEAPON_TARGET } },
   ai:     { dew: { src: '/weapon-dew-ai.png',     targetSize: WEAPON_TARGET } },
   ```
   The map is `Partial` on both axes and `spriteSources()` collects whatever is in it,
   so a weapon without art keeps its Graphics marker and the build stays green.
