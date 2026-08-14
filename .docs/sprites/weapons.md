# Weapon module sprite prompts

Weapons are **top-mounted modules** rendered on the robot's central hardpoint —
the flat circular mount the [robot prompts](robots.md) deliberately leave empty —
**over any chassis**. So a weapon needs **one small module sprite per faction**,
not a full robot per chassis×weapon combination. This matches how the engine
draws weapons today (a marker on top of the chassis) and scales cleanly as
weapons are added.

Covered here: **every** buildable weapon — **radar**, **bomb (kamikaze)**, **DEW
(directed-energy weapon)**, **cannon**, **missiles**, **EW (jammer)** and the
**FPV carrier**. The full weapon list is `types/src/enums.ts` → `WeaponType`
(`none` is the unarmed payload and never draws a module).

## Read this before touching a prompt below

The modules used to be near-indistinguishable on the field. The cause was not
sloppy generation — it was **this file**, which told every prompt to use the
faction palette (blue/teal for the player, red/gunmetal for the enemy) and said
nothing about how much detail survives to the screen. Seven modules built to the
same colour brief, at 24 px, are seven identical smudges.

Two rules below fix that, and they only work together. **Do not restore the
faction palette on a module, and do not add detail back.**

### Rule 1 — colour says *which weapon*, never *which side*

A module is **neutral dark gunmetal**, identically for both factions, and carries
**one weapon-role colour** that is the *same hex on both sides*:

| Weapon     | Colour               | Hex        | How it appears in the art                    |
| ---------- | -------------------- | ---------- | -------------------------------------------- |
| `dew`      | ice white-blue       | `#d8eef7`  | plasma glow over the emitter coils           |
| `radar`    | pale jade            | `#a9dcc8`  | enamel of the dish face                      |
| `cannon`   | brass                | `#c8a34a`  | barrel and breech                            |
| `fpv`      | olive drab           | `#7d8452`  | matte canister shell                         |
| `ew`       | plum                 | `#8a72ab`  | dielectric sleeves on the aerials            |
| `missiles` | brick rust           | `#a8543a`  | oxidised launch tubes                        |
| `bomb`     | hazard yellow + black| `#e0b13c` / `#1a1a1a` | chevrons across the payload      |

- The role colour must cover **≥30% of the module's area** in one or two solid
  masses. Thin lines, rims and glows average into nothing at final size — that is
  exactly what happened to the old cyan accents, which covered 5–8%.
- These values are mirrored in code as `palette.weapon` in
  `client/src/config/palette.ts`, which the Graphics fallback markers draw from.
  **Change one, change both.**
- The colours are muted on purpose: the saturated part of the wheel belongs to
  *state* (`#ef4444` attack, `#fde047` selection, `#f59e0b` spotted, `#7dd3fc`
  disabled). A permanent property of a unit must not wear the colour of a passing
  one. They are also spread along a **lightness ladder** (dew brightest →
  missiles darkest) so they stay separable for the ~8% of men who cannot tell red
  from green.
- **Faction still reads on the module — through form and wear, not hue.** Player:
  clean, rounded armour plates, crisp bevels, well maintained. Enemy: angular
  chipped plating, rust streaks, soot. See the carve-out in
  [README.md § Faction visual language](README.md#faction-visual-language-this-is-how-enemies-look-different).
  Whose robot it is, is answered by the chassis under the module anyway.

### Rule 2 — detail budget: three or four shapes, nothing more

A module is authored at 512 px and drawn at **30 px**. The camera has no zoom, so
30 px is not a starting size — it is the *only* size a player ever sees it at.
That is a **~17:1** reduction, and downscaling is averaging: any region packed
with fine detail collapses to its own mean colour. Bolts, panel lines, bevels and
rivets do not become "subtle" at that scale, they become grey mush that also
drags the contrast out of the shapes around them.

So:

- **Three or four shapes total.** Not three or four groups — three or four shapes.
- **One dominant form** carrying the weapon's identity, at **⅓ to ½ of the whole
  module**. The dish *is* the radar module; it does not sit inside a frame.
- Every remaining element ≥ **1/6 of the module's width** (≈5 px on screen).
  Anything smaller must be cut, not shrunk.
- **Thick dark outline** around the silhouette and the dominant form. It is the
  first thing lost to averaging and the last thing that should be.
- Contrast lives **between** shapes, not inside them. No gradients, no specular
  streaks, no material texture on anything under a third of the module.
- No text, no tiny status LEDs, no antenna wires, no hazard decals other than the
  bomb's chevrons.

**Acceptance:** put a 30 px preview next to the canvas and judge only by that.
Then desaturate the seven finished player modules side by side — if any two are
hard to tell apart in greyscale, their lightness has collided and the palette
table above needs re-spreading. Colour is the channel that survives the
downscale; greyscale is how you prove it is actually doing work.

## Module-specific spec (in addition to the [Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary))

- **It's a small module, not a whole robot.** Design just the weapon device on a
  compact armored mount plate — it sits on the center of a robot 46 px wide, and
  is drawn at 30 px, roughly two thirds of it.
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

Reminder baked into each prompt: **top-down, transparent background, 512×512,
centered small module, no baked shadow, dark gunmetal body, one role colour,
three or four shapes.**

---

## Radar — spotter module (no weapon; doubles detection range)

**Dominant form:** the pale jade dish, filling most of the module. It is not
mounted *in* a frame — the dish is the module. Shapes: dish, mount bar, hub.

### Player (allied) — `weapon-radar-player.png`

```text
Top-down (bird's-eye) game sprite of a compact radar sensor module that bolts onto
the central hardpoint of a combat robot, viewed from directly above. Extremely
simple, bold shapes: one large shallow dish in pale jade green enamel (hex a9dcc8)
filling about 85 percent of the module, a single dark gunmetal mount bar crossing
beneath it, and one small dark hub at the dish center. The body is neutral dark
gunmetal with clean rounded armor edges — no faction colors, no blue, no teal, no
cyan. Only three shapes in total: dish, bar, hub. No bolts, no panel lines, no
bevels, no rivets, no status lights, no text, no gradients — flat solid colors
with a thick dark outline around the silhouette and around the dish. No barrel and
no projectile weapon: clearly a sensor. Radially balanced so it reads from any
angle. Semi-flat stylized game art, soft top lighting. Fully transparent
background, no ground, no shadow. Centered, the module filling about 65% of a
512x512 frame with generous even padding. Must stay readable when shrunk to 30
pixels.
```

### Enemy (AI / hostile) — `weapon-radar-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact radar sensor module that bolts onto
the central hardpoint of a combat robot, viewed from directly above. Extremely
simple, bold shapes: one large shallow dish in pale jade green enamel (hex a9dcc8),
chipped and streaked with rust, filling about 85 percent of the module, a single
dark gunmetal mount bar crossing beneath it, and one small dark hub at the dish
center. The body is neutral dark gunmetal with angular battered armor edges and
soot marks — no faction colors, no red, no orange plating. Only three shapes in
total: dish, bar, hub. No bolts, no panel lines, no bevels, no rivets, no status
lights, no text, no gradients — flat solid colors with a thick dark outline around
the silhouette and around the dish. No barrel and no projectile weapon: clearly a
sensor. Radially balanced so it reads from any angle. Semi-flat stylized game art,
soft top lighting. Fully transparent background, no ground, no shadow. Centered,
the module filling about 65% of a 512x512 frame with generous even padding. Must
stay readable when shrunk to 30 pixels.
```

---

## Bomb — kamikaze payload module (detonates on contact)

**Dominant form:** the payload disc under a bold black-and-yellow hazard cross —
the only **striped** module in the set, which is half of what identifies it.
Shapes: disc, chevron cross, rim. (It also carries a drawn blast-radius ring in
`RobotView`, so it is the best-identified weapon on the field even today.)

### Player (allied) — `weapon-bomb-player.png`

```text
Top-down (bird's-eye) game sprite of an explosive kamikaze payload module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one large round warhead casing filling about 80
percent of the module, painted with a thick bold hazard pattern of alternating
yellow (hex e0b13c) and black (hex 1a1a1a) chevron bands running across it in a
wide cross, and one dark gunmetal rim around the casing. The body is neutral dark
gunmetal with clean rounded armor edges — no faction colors, no blue, no teal, no
cyan. Only three shapes in total: casing, chevron cross, rim. The chevron bands
must be wide and few — four or five bands, not a fine stripe pattern. No bolts, no
panel lines, no rivets, no arming lights, no text, no gradients — flat solid colors
with a thick dark outline. Unmistakably an explosive payload. Radially balanced, no
single front. Semi-flat stylized game art, soft top lighting. Fully transparent
background, no ground, no shadow. Centered, the module filling about 65% of a
512x512 frame with generous even padding. Must stay readable when shrunk to 30
pixels.
```

### Enemy (AI / hostile) — `weapon-bomb-ai.png`

```text
Top-down (bird's-eye) game sprite of an explosive kamikaze payload module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one large crude round warhead casing filling about
80 percent of the module, painted with a thick bold hazard pattern of alternating
yellow (hex e0b13c) and black (hex 1a1a1a) chevron bands running across it in a
wide cross, scratched and scorched, and one dark gunmetal rim around the casing.
The body is neutral dark gunmetal with angular battered armor edges and soot marks
— no faction colors, no red, no orange plating. Only three shapes in total: casing,
chevron cross, rim. The chevron bands must be wide and few — four or five bands,
not a fine stripe pattern. No bolts, no panel lines, no rivets, no arming lights,
no text, no gradients — flat solid colors with a thick dark outline. Unmistakably a
crude improvised explosive payload. Radially balanced, no single front. Semi-flat
stylized game art, soft top lighting. Fully transparent background, no ground, no
shadow. Centered, the module filling about 65% of a 512x512 frame with generous
even padding. Must stay readable when shrunk to 30 pixels.
```

---

## DEW — directed-energy emitter module (no damage; disables the target)

The directed-energy weapon induces high-voltage currents in the target and knocks its
electrics and electronics out for 8 seconds — see `.docs/tasks/weapon-dew.md`. It must
read as an **energy emitter, not a gun**: no barrel and no shell, so a player can tell
at a glance that this unit disables rather than kills.

**Dominant form:** a thick ice-white ring of plasma — the **brightest** thing in
the weapon set, which is its identity as much as its shape. Shapes: ring, core,
body. Deliberately unlike the `ew` cross (which is an antenna mast, not a coil).
Its ice-blue is the same family as the "disabled" arcs drawn over a knocked-out
robot, and that rhyme is intended: this is the weapon that puts them there.

### Player (allied) — `weapon-dew-player.png`

```text
Top-down (bird's-eye) game sprite of a compact directed-energy emitter module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one thick glowing ring of ice white-blue plasma (hex
d8eef7) filling about 80 percent of the module — the brightest element by far — a
single bright core dot at its center, and a neutral dark gunmetal body ring behind
it with clean rounded armor edges. No faction colors, no blue-and-teal plating, no
cyan panels. Only three shapes in total: plasma ring, core, body. No coil windings,
no bolts, no panel lines, no fine crackling arcs, no text, no gradients — flat solid
colors with a thick dark outline around the silhouette. No barrel, no shell, no
explosive: clearly an energy emitter, not a gun, and clearly not an antenna mast.
Radially balanced so it reads from any angle. Semi-flat stylized game art, soft top
lighting. Fully transparent background, no ground, no shadow. Centered, the module
filling about 65% of a 512x512 frame with generous even padding. Must stay readable
when shrunk to 30 pixels.
```

### Enemy (AI / hostile) — `weapon-dew-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact directed-energy emitter module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one thick glowing ring of ice white-blue plasma (hex
d8eef7) filling about 80 percent of the module — the brightest element by far — a
single bright core dot at its center, and a neutral dark gunmetal body ring behind
it with angular battered armor edges, rust streaks and burn marks. No faction
colors, no red, no orange plating, no magenta. Only three shapes in total: plasma
ring, core, body. No coil windings, no bolts, no panel lines, no fine crackling
arcs, no text, no gradients — flat solid colors with a thick dark outline around the
silhouette. No barrel, no shell, no explosive: clearly a sinister energy emitter,
not a gun, and clearly not an antenna mast. Radially balanced so it reads from any
angle. Semi-flat stylized game art, soft top lighting. Fully transparent background,
no ground, no shadow. Centered, the module filling about 65% of a 512x512 frame with
generous even padding. Must stay readable when shrunk to 30 pixels.
```

---

## Cannon — light direct-fire gun (the cheap default weapon)

The workhorse: short reach, small damage on a fast cooldown, no splash and no
anti-air. It should read as the **plain, sturdy, unremarkable gun** — the baseline
every other module is a deviation from.

**Dominant form:** one thick brass barrel running the full length of the module.
It is the only module with a single long axis, and at this size that elongation is
worth more than any turret detail. Shapes: barrel, breech block, plate.
**Directional:** barrel points **up (north)**.

### Player (allied) — `weapon-cannon-player.png`

```text
Top-down (bird's-eye) game sprite of a compact autocannon module that bolts onto the
central hardpoint of a combat robot, viewed from directly above. Extremely simple,
bold shapes: one thick brass gun barrel (hex c8a34a) running the full height of the
module and pointing straight up toward the top of the frame, one chunky dark
gunmetal breech block behind it, and a small neutral dark gunmetal mount plate under
both, with clean rounded armor edges. No faction colors, no blue, no teal, no cyan.
Only three shapes in total: barrel, breech, plate. No ammo box, no recoil sleeve, no
bolts, no panel lines, no status lights, no text, no gradients — flat solid colors
with a thick dark outline. Plain, sturdy, utilitarian: clearly a simple projectile
gun, not a missile launcher and not an energy weapon. The long single barrel is the
whole read. Semi-flat stylized game art, soft top lighting. Fully transparent
background, no ground, no shadow, no muzzle flash. Centered, the module filling about
65% of a 512x512 frame with generous even padding. Must stay readable when shrunk to
30 pixels.
```

### Enemy (AI / hostile) — `weapon-cannon-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact autocannon module that bolts onto the
central hardpoint of a combat robot, viewed from directly above. Extremely simple,
bold shapes: one thick brass gun barrel (hex c8a34a), scratched and soot-blackened
at the muzzle, running the full height of the module and pointing straight up toward
the top of the frame, one chunky dark gunmetal breech block behind it, and a small
neutral dark gunmetal mount plate under both, with angular battered armor edges and
rust streaks. No faction colors, no red, no orange plating. Only three shapes in
total: barrel, breech, plate. No ammo box, no recoil sleeve, no bolts, no panel
lines, no status lights, no text, no gradients — flat solid colors with a thick dark
outline. Crude, brutal, utilitarian: clearly a simple projectile gun, not a missile
launcher and not an energy weapon. The long single barrel is the whole read.
Semi-flat stylized game art, soft top lighting. Fully transparent background, no
ground, no shadow, no muzzle flash. Centered, the module filling about 65% of a
512x512 frame with generous even padding. Must stay readable when shrunk to 30
pixels.
```

---

## Missiles — guided launcher, the only surface-to-air weapon

The heavy hitter and this side's **only answer to an enemy observer drone**
(`canHitAir`): longest reach, biggest per-shot damage, slow cooldown, priciest gun
in the list. It must read as **missiles, not a gun**, and look meaningfully
heavier than the cannon.

**Dominant form:** **two** fat brick-red launch tubes with dark open mouths — not
the old two-by-two cluster of four. Four tubes at 30 px are four 6 px specks; two
tubes are two 10 px masses that still read as tubes. Shapes: two tubes, plate.
**Directional:** tubes point **up (north)**.

### Player (allied) — `weapon-missiles-player.png`

```text
Top-down (bird's-eye) game sprite of a compact guided-missile launcher module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: exactly two fat parallel launch tubes in brick rust
red (hex a8543a) side by side, running the full height of the module and aimed
straight up toward the top of the frame, each with a large dark open mouth, sitting
on a small neutral dark gunmetal mount plate with clean rounded armor edges. Exactly
two tubes, not four, and each tube must be thick and chunky. No faction colors, no
blue, no teal, no cyan. Only three shapes in total: two tubes, plate. No guidance
fin, no seeker lights, no warhead noses, no bolts, no panel lines, no text, no
gradients — flat solid colors with a thick dark outline. Clearly a missile pod,
heavier and blockier than a gun barrel. Semi-flat stylized game art, soft top
lighting. Fully transparent background, no ground, no shadow, no smoke, no exhaust
trails. Centered, the module filling about 65% of a 512x512 frame with generous even
padding. Must stay readable when shrunk to 30 pixels.
```

### Enemy (AI / hostile) — `weapon-missiles-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact guided-missile launcher module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: exactly two fat parallel launch tubes in brick rust
red (hex a8543a), dented and streaked with rust, side by side, running the full
height of the module and aimed straight up toward the top of the frame, each with a
large soot-blackened open mouth, sitting on a small neutral dark gunmetal mount plate
with angular battered armor edges. Exactly two tubes, not four, and each tube must be
thick and chunky. No faction colors, no red plating, no orange plating beyond the
tubes' own rust color. Only three shapes in total: two tubes, plate. No guidance
antenna, no seeker lights, no warhead noses, no bolts, no panel lines, no text, no
gradients — flat solid colors with a thick dark outline. Clearly a crude missile pod,
heavier and blockier than a gun barrel. Semi-flat stylized game art, soft top
lighting. Fully transparent background, no ground, no shadow, no smoke, no exhaust
trails. Centered, the module filling about 65% of a 512x512 frame with generous even
padding. Must stay readable when shrunk to 30 pixels.
```

---

## EW — electronic-warfare jammer module (no damage; blinds enemy scouts)

An unarmed support module: it halves the effective sight range of enemy scouts
inside its aura (`jamRadius` + `combat.jamMultiplier`). It has to read as an
**emitter of noise, not of energy or shells**.

**Dominant form:** a bold plum X of four thick aerials reaching to the module's
edge — a cross, where `dew` is a ring and `radar` is a disc. Shapes: four aerials
(one form), hub, plate.

### Player (allied) — `weapon-ew-player.png`

```text
Top-down (bird's-eye) game sprite of a compact electronic-warfare jammer module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: four thick straight aerials in plum purple (hex
8a72ab) arranged as a bold X reaching out to the edge of the module, one dark
gunmetal hub where they cross, and a small neutral dark gunmetal mount plate beneath,
with clean rounded armor edges. The aerials must be thick chunky bars, not thin
wires. No faction colors, no blue, no teal, no cyan. Only three shapes in total:
aerial cross, hub, plate. No interference rings, no emitter panels, no bolts, no
panel lines, no status lights, no text, no gradients — flat solid colors with a thick
dark outline. No dish, no ring of coils, no barrel and no warhead: clearly a signal
jammer, and clearly distinct from a radar dish and from an emitter ring. Radially
balanced so it reads from any angle. Semi-flat stylized game art, soft top lighting.
Fully transparent background, no ground, no shadow. Centered, the module filling
about 65% of a 512x512 frame with generous even padding. Must stay readable when
shrunk to 30 pixels.
```

### Enemy (AI / hostile) — `weapon-ew-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact electronic-warfare jammer module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: four thick straight aerials in plum purple (hex
8a72ab), bent and scratched, arranged as a bold X reaching out to the edge of the
module, one dark gunmetal hub where they cross, and a small neutral dark gunmetal
mount plate beneath, with angular battered armor edges and rust streaks. The aerials
must be thick chunky bars, not thin wires. No faction colors, no red, no orange
plating, no magenta. Only three shapes in total: aerial cross, hub, plate. No
interference rings, no emitter panels, no bolts, no panel lines, no status lights, no
text, no gradients — flat solid colors with a thick dark outline. No dish, no ring of
coils, no barrel and no warhead: clearly a sinister signal jammer, and clearly
distinct from a radar dish and from an emitter ring. Radially balanced so it reads
from any angle. Semi-flat stylized game art, soft top lighting. Fully transparent
background, no ground, no shadow. Centered, the module filling about 65% of a 512x512
frame with generous even padding. Must stay readable when shrunk to 30 pixels.
```

---

## FPV — loitering-munition carrier module (launches a swarm of strike drones)

A ground robot carrying a sealed launch canister that pops open and releases a
small salvo of single-use FPV strike drones; each drone flies off, hits one target
for about a cannon shot's damage, and is gone. The pod then reloads.

**Dominant form:** an olive-drab canister perforated by **five** big dark launch
cells — the salvo size is legible from the art itself. At 30 px the folded rotors
and camera lenses the old brief asked for are 3 px each and cannot survive; what
survives is the **perforated pattern**, which is unique in this set. If the salvo
size in `gameConfig` changes, re-generate rather than let the art lie.

**Not directional:** the drones leave straight up, so no `rotationOffset`.

### Player (allied) — `weapon-fpv-player.png`

```text
Top-down (bird's-eye) game sprite of a compact FPV strike-drone carrier module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one thick rounded-square canister shell in matte olive
drab green (hex 7d8452) filling about 85 percent of the module, perforated by exactly
five large dark open launch cells — one in the center ringed by four — and a neutral
dark gunmetal rim around the shell, with clean rounded armor edges. The five cells
must be big dark holes, clearly countable. No faction colors, no blue, no teal, no
cyan. Only three shapes in total: shell, five cells, rim. No drones visible inside,
no rotor blades, no camera lenses, no hatch doors, no antenna, no bolts, no panel
lines, no status lights, no text, no gradients — flat solid colors with a thick dark
outline. Clearly a perforated launch canister — not a missile pod with two tubes, not
a gun barrel, not a dish. Radially balanced so it reads from any angle. Semi-flat
stylized game art, soft top lighting. Fully transparent background, no ground, no
shadow, no smoke, no exhaust trails. Centered, the module filling about 65% of a
512x512 frame with generous even padding. Must stay readable when shrunk to 30 pixels.
```

### Enemy (AI / hostile) — `weapon-fpv-ai.png`

```text
Top-down (bird's-eye) game sprite of a compact FPV strike-drone carrier module that
bolts onto the central hardpoint of a combat robot, viewed from directly above.
Extremely simple, bold shapes: one thick rounded-square canister shell in matte olive
drab green (hex 7d8452), scratched and streaked with rust, filling about 85 percent of
the module, perforated by exactly five large soot-blackened open launch cells — one in
the center ringed by four — and a neutral dark gunmetal rim around the shell, with
angular battered armor edges. The five cells must be big dark holes, clearly countable.
No faction colors, no red, no orange plating. Only three shapes in total: shell, five
cells, rim. No drones visible inside, no rotor blades, no camera lenses, no hatch
doors, no antenna, no bolts, no panel lines, no status lights, no text, no gradients —
flat solid colors with a thick dark outline. Clearly a crude perforated launch canister
— not a missile pod with two tubes, not a gun barrel, not a dish. Radially balanced so
it reads from any angle. Semi-flat stylized game art, soft top lighting. Fully
transparent background, no ground, no shadow, no smoke, no exhaust trails. Centered,
the module filling about 65% of a 512x512 frame with generous even padding. Must stay
readable when shrunk to 30 pixels.
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
   `client/scripts/encode-sprites.mjs` at `size: 96`, and run the script — modules
   are drawn at 30 px, so 96² is a comfortable 3× (see
   [README.md](README.md#where-the-files-live-masters-vs-what-ships)).

   Art usually lands one weapon at a time, so pass the name to encode just that
   pair and leave every other `.webp` untouched:

   ```sh
   node scripts/encode-sprites.mjs radar     # → weapon-radar-player + -ai
   ```
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

**Modules are never team-tinted.** `RobotView` passes no tint to the hardpoint
sprite, on purpose: multiplying a role colour by a side colour would destroy the
one channel that survives the downscale, and it would do it for sides `AI2`/`AI3`
specifically — where telling a cannon from a jammer matters most. The tinted
chassis underneath still says whose robot it is.

`UnitsGuideModal` reads the same `weaponSprites` table for its player-faction thumbnails,
so a weapon gains its picture in the reference the moment it gains one on the field —
there is no second list to update. That modal is also where a player *learns* the colour
code, so it is worth opening after regenerating art.
