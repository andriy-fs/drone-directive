# Weapon module sprite prompts

Weapons are **top-mounted modules** rendered on the robot's central hardpoint —
the flat circular mount the [robot prompts](robots.md) deliberately leave empty —
**over any chassis**. So a weapon needs **one small module sprite per faction**,
not a full robot per chassis×weapon combination. This matches how the engine
draws weapons today (a marker on top of the chassis) and scales cleanly as
weapons are added.

Covered here: **every** buildable weapon — **radar**, **bomb (kamikaze)**, **DEW
(directed-energy weapon)**, **cannon**, **missiles**, **EW (jammer)** and the
planned **FPV carrier**. The full weapon list is `types/src/enums.ts` →
`WeaponType` (`none` is the unarmed payload and never draws a module). The first
six ship art for both factions; **FPV** is a prompt written ahead of the feature,
so until its PNGs land it keeps the drawn Graphics marker in `RobotView` — that
fallback is exactly what it is for.

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
  **Exception — barrelled weapons.** `cannon` and `missiles` can't hide a muzzle,
  so those two are authored **facing up (north)** like the robots, and their
  entries in `weaponSprites` need `rotationOffset: Math.PI / 2` so the barrel
  points where the robot is heading. Every other module here stays symmetric and
  needs no offset.
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

## Cannon — light direct-fire gun (the cheap default weapon)

The workhorse: short reach (120 px), small damage (12) on a fast 0.8 s cooldown, no
splash and no anti-air. It should read as the **plain, sturdy, unremarkable gun** — the
baseline every other module is a deviation from, so keep it simpler and less exotic
than the missile pod or the DEW coil. **Directional:** author it with the barrel
pointing **up (north)**; see the rotation note in the spec above.

### Player (allied) — `weapon-cannon-player.png`

```text
Top-down (bird's-eye) game sprite of a compact autocannon turret module that bolts onto
the central hardpoint of a combat robot, viewed from directly above. A small round
armored turret on a mount plate with a single short stubby gun barrel pointing straight
up toward the top of the frame, a slim recoil sleeve and a small ammo box on the side.
Allied faction design: cool blue and teal plating with brushed steel, a dark gunmetal
barrel and a small cyan status light. Plain, sturdy, utilitarian — clearly a simple
projectile gun, not a missile launcher and not an energy weapon. Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting. Fully
transparent background, no ground, no shadow, no text, no muzzle flash. Centered, the
module filling about 65% of a 512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-cannon-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact autocannon turret module that bolts onto
the central hardpoint of a combat robot, viewed from directly above. A crude angular
armored turret on a jagged mount plate with a single short stubby gun barrel pointing
straight up toward the top of the frame, a battered recoil sleeve and a dented ammo box
on the side. Hostile enemy faction design: dark gunmetal and red-orange plating, rust
streaks, scorch marks around the muzzle and a glaring red status light. Crude, brutal,
utilitarian — clearly a simple projectile gun, not a missile launcher and not an energy
weapon. Bold readable silhouette, semi-flat stylized art with light cel shading, soft
top lighting. Fully transparent background, no ground, no shadow, no text, no muzzle
flash. Centered, the module filling about 65% of a 512x512 frame with generous even
padding.
```

---

## Missiles — guided launcher, the only surface-to-air weapon

The heavy hitter and this side's **only answer to an enemy observer drone** (`canHitAir`):
longest reach (170 px), biggest per-shot damage (22), slow 1.6 s cooldown, priciest gun
in the list. It must read as **missiles, not a gun** — visible tube mouths / warhead
noses, no long rifled barrel — and it should look meaningfully **heavier and more
expensive** than the cannon. A slight upward tilt of the tubes is welcome as an anti-air
cue. **Directional:** tubes point **up (north)**; see the rotation note in the spec above.

### Player (allied) — `weapon-missiles-player.png`

```text
Top-down (bird's-eye) game sprite of a compact guided-missile launcher module that bolts
onto the central hardpoint of a combat robot, viewed from directly above. A boxy armored
launcher pod on a mount plate holding a two-by-two cluster of open missile tubes aimed
straight up toward the top of the frame, the pointed warhead noses visible inside the
tube mouths, with a small guidance radar fin on the side. Allied faction design: cool
blue and teal plating with brushed steel, dark tube interiors and small cyan seeker
lights on the warhead tips. Clearly a missile pod, not a gun barrel — heavier and more
elaborate than a simple cannon. Bold readable silhouette, semi-flat stylized art with
light cel shading, soft top lighting. Fully transparent background, no ground, no shadow,
no text, no smoke and no exhaust trails. Centered, the module filling about 65% of a
512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-missiles-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact guided-missile launcher module that bolts
onto the central hardpoint of a combat robot, viewed from directly above. A crude angular
armored launcher pod on a jagged mount plate holding a two-by-two cluster of open missile
tubes aimed straight up toward the top of the frame, the pointed warhead noses visible
inside the tube mouths, with a bent guidance antenna on the side. Hostile enemy faction
design: dark gunmetal and red-orange plating, rust streaks, soot-blackened tube mouths
and glowing red seeker lights on the warhead tips. Clearly a missile pod, not a gun
barrel — heavier and more menacing than a simple cannon. Bold readable silhouette,
semi-flat stylized art with light cel shading, soft top lighting. Fully transparent
background, no ground, no shadow, no text, no smoke and no exhaust trails. Centered, the
module filling about 65% of a 512x512 frame with generous even padding.
```

---

## EW — electronic-warfare jammer module (no damage; blinds enemy scouts)

An unarmed support module: it halves the effective sight range of enemy scouts inside a
150 px aura (`jamRadius` + `combat.jamMultiplier`). It has to read as an **emitter of
noise, not of energy or shells** — a mast of antennas and whip aerials with faint
concentric interference rings. Keep it clearly distinct from its two neighbours: `radar`
is a **dish that listens**, `dew` is a **coil ring that arcs**, `ew` is an **antenna mast
that broadcasts static**.

### Player (allied) — `weapon-ew-player.png`

```text
Top-down (bird's-eye) game sprite of a compact electronic-warfare jammer module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A small
armored mount plate carrying a short central antenna mast ringed by four thin whip
aerials and a cluster of tiny emitter panels, with faint concentric rings of broadcast
interference radiating outward. Allied faction design: cool blue and teal plating with
brushed steel and soft cyan signal glow on the aerial tips. No dish, no coils, no barrel
and no warhead — clearly a signal jammer, distinct from a radar dish and from an energy
emitter. Radially balanced so it reads from any angle. Bold readable silhouette,
semi-flat stylized art with light cel shading, soft top lighting. Fully transparent
background, no ground, no shadow, no text. Centered, the module filling about 65% of a
512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-ew-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact electronic-warfare jammer module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A jagged
armored mount plate carrying a crooked central antenna mast ringed by four bent spiky
whip aerials and a cluster of battered emitter panels, with harsh concentric rings of
broadcast interference radiating outward. Hostile enemy faction design: dark gunmetal and
red-orange plating, rust streaks and a sickly magenta-red signal glow on the aerial tips.
No dish, no coils, no barrel and no warhead — clearly a sinister signal jammer, distinct
from a radar dish and from an energy emitter. Radially balanced so it reads from any
angle. Bold readable silhouette, semi-flat stylized art with light cel shading, soft top
lighting. Fully transparent background, no ground, no shadow, no text. Centered, the
module filling about 65% of a 512x512 frame with generous even padding.
```

---

## FPV — loitering-munition carrier module (launches a swarm of strike drones)

**Planned, art not generated yet.** A ground robot carrying a sealed launch canister
that pops open and releases a small salvo of single-use FPV strike drones; each drone
flies off, hits one target for about a cannon shot's damage, and is gone. The pod then
reloads for several seconds.

It must read as a **container that holds flyers**, not as a gun and not as the missile
pod: the giveaway is a cluster of **open hexagonal launch cells with folded rotor blades
visible inside**, plus split hatch doors hinged back over the shoulders of the plate. No
barrel, no warhead noses, no dish, no coils. Next to `missiles` the difference has to be
obvious at 24 px — missiles show **pointed noses in round tubes**, FPV shows **folded
props in honeycomb cells**.

**Not directional:** the drones leave straight up, so the module is authored radially
balanced like `radar`/`ew`/`dew` and needs **no** `rotationOffset`. Draw **five** cells
so the salvo size is legible from the art itself (a ring of four around one center cell
keeps it symmetric — if the number changes in `gameConfig`, re-generate rather than let
the art lie).

### Player (allied) — `weapon-fpv-player.png`

```text
Top-down (bird's-eye) game sprite of a compact FPV strike-drone carrier module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A small
armored mount plate carrying a hexagonal launch canister whose split hatch doors are
folded open, revealing five honeycomb launch cells — one in the center ringed by four —
each holding a tiny quad-rotor attack drone nested nose-up with its rotor arms folded
in, so the folded props and a tiny camera lens are visible inside each cell. A slim
control antenna and a small video-link module sit on the edge of the plate. Allied
faction design: cool blue and teal plating with brushed steel, dark cell interiors and
small cyan status lights ringing the canister rim. Clearly a container full of folded
flying drones — not a missile pod with pointed warheads, not a gun barrel, not a dish.
Radially balanced so it reads from any angle. Bold readable silhouette, semi-flat
stylized art with light cel shading, soft top lighting. Fully transparent background, no
ground, no shadow, no text, no smoke and no exhaust trails. Centered, the module filling
about 65% of a 512x512 frame with generous even padding.
```

### Enemy (AI / hostile) — `weapon-fpv-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact FPV strike-drone carrier module that
bolts onto the central hardpoint of a combat robot, viewed from directly above. A jagged
armored mount plate carrying a crude hexagonal launch canister whose battered split
hatch doors are wrenched open, revealing five honeycomb launch cells — one in the center
ringed by four — each holding a tiny quad-rotor attack drone nested nose-up with its
rotor arms folded in, so the folded props and a tiny camera lens are visible inside each
cell. A bent control antenna and a taped-on video-link box sit on the edge of the plate.
Hostile enemy faction design: dark gunmetal and red-orange plating, rust streaks,
soot-blackened cell mouths and glaring red status lights ringing the canister rim.
Clearly a sinister container full of folded flying drones — not a missile pod with
pointed warheads, not a gun barrel, not a dish. Radially balanced so it reads from any
angle. Bold readable silhouette, semi-flat stylized art with light cel shading, soft top
lighting. Fully transparent background, no ground, no shadow, no text, no smoke and no
exhaust trails. Centered, the module filling about 65% of a 512x512 frame with generous
even padding.
```

### The munition itself is a second, separate sprite

The module above is only what sits on the chassis. The launched drone is its own
airborne entity with its own art — a **strike variant of the observer drone**: same
quad-rotor read, camera gimbal swapped for a blunt shaped-charge nose. **One art set for
every side**, recoloured per owner exactly as the observer is, at **30 px** on field
(observer 40, robot 46), because five arrive at once and the swarm must not outweigh the
robot that launched it. Its prompt lives with the other flyer, in
[`drone.md` → FPV strike drone](drone.md#fpv-strike-drone--fpv-munitionpng) — this file
is modules only.

---

## Wiring generated weapon modules into the game

The plumbing already exists — `weaponSprites` in `client/src/config/sprites.ts`,
`getWeaponTexture()` in `client/src/pixi/assets.ts`, and the hardpoint child sprite in
`RobotView` (which falls back to the drawn Graphics marker when a weapon has no art).
So adding a module is two steps:

1. Export transparent PNGs to `client/assets-src/sprites/`, named
   `weapon-<type>-<faction>.png` (e.g. `weapon-radar-ai.png`,
   `weapon-dew-player.png`), add the pair to the `SPRITES` table in
   `client/scripts/encode-sprites.mjs` at `size: 64`, and run the script — modules
   are drawn at 24 px, so 64² is already generous (see
   [README.md](README.md#where-the-files-live-masters-vs-what-ships)).
2. Add the pair to `weaponSprites`, keyed `owner → weapon`, using the shared
   `WEAPON_TARGET` size:
   ```ts
   player: { dew: { src: '/weapon-dew-player.webp', targetSize: WEAPON_TARGET } },
   ai:     { dew: { src: '/weapon-dew-ai.webp',     targetSize: WEAPON_TARGET } },
   ```
   The map is `Partial` on both axes and `spriteSources()` collects whatever is in it,
   so a weapon without art keeps its Graphics marker and the build stays green.
   For the two **barrelled** modules add the heading correction as well, exactly as the
   robot entries do — without it the barrel always points east:
   ```ts
   player: { cannon: { src: '…', targetSize: WEAPON_TARGET, rotationOffset: Math.PI / 2 } },
   ```

`UnitsGuideModal` reads the same `weaponSprites` table for its player-faction thumbnails,
so a weapon gains its picture in the reference the moment it gains one on the field —
there is no second list to update.
