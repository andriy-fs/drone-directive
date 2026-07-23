# Weapon module sprite prompts

Weapons are **top-mounted modules** rendered on the robot's central hardpoint —
the flat circular mount the [robot prompts](robots.md) deliberately leave empty —
**over any chassis**. So a weapon needs **one small module sprite per faction**,
not a full robot per chassis×weapon combination. This matches how the engine
draws weapons today (a marker on top of the chassis) and scales cleanly as
weapons are added.

Covered here: **radar** and **bomb (kamikaze)** — the two weapons without art yet
(`cannon`/`missiles` currently use simple drawn markers; add them the same way if
you want sprite parity). The full weapon list is `src/types/enums.ts` →
`WeaponType`.

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

## Wiring generated weapon modules into the game

Weapon modules aren't rendered from sprites yet (the engine draws small Graphics
markers in `RobotView`). To use these:

1. Export transparent PNGs to `public/`, named `weapon-<type>-<faction>.png`
   (e.g. `weapon-radar-ai.png`, `weapon-bomb-player.png`).
2. Add a `weaponSprites` map to `src/config/sprites.ts`, keyed `owner → weapon`,
   mirroring `robotSprites` (a small `targetSize`, ~22–24 px):
   ```ts
   export const weaponSprites: Partial<Record<Owner, Partial<Record<WeaponType, SpriteDef>>>> = {
     player: { radar: { src: '/weapon-radar-player.png', targetSize: 24 }, bomb: { src: '/weapon-bomb-player.png', targetSize: 24 } },
     ai:     { radar: { src: '/weapon-radar-ai.png',     targetSize: 24 }, bomb: { src: '/weapon-bomb-ai.png',     targetSize: 24 } },
   };
   ```
   Add a `getWeaponTexture(weapon, owner)` in `src/pixi/assets.ts` (same cached
   pattern as `getRobotTexture`) and include the sources in `spriteSources()`.
3. In `RobotView`, add the weapon module as a child sprite on the hardpoint after
   the chassis body, falling back to the existing Graphics marker when no sprite
   is loaded.

Generate the four modules and I'll wire this up, same as the robot/base sprites.
