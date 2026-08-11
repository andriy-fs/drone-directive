# Flyer sprite prompts (observer drone + FPV strike drone)

The game's two **airborne** entities. Neither gets a per-faction pair the way
robots and bases do: each is **one art set, recoloured per owner at runtime**
(`DroneView` / `MunitionView` tint every side but the local one via `ownerColor`),
so one PNG covers the whole match. The prompts bake in the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary);
re-sync the intro line if the shared rules change. Copy a fenced block straight
into Gemini / ChatGPT.

Reminder baked into both prompts: **top-down, facing straight up, transparent
background, 512×512, centered, one unit.** Unlike the robots, a flyer carries no
mounted weapon module, so neither needs a **central hardpoint** — the dorsal
center is the unit's defining feature instead (a camera gimbal on one, a warhead
on the other). Both must read as **airborne and light**, not as ground vehicles:
visible rotor arms/props and a compact silhouette.

**The two must not be confusable.** They fly in the same airspace, both get
tinted the same way, and one of them is about to kill you — so the observer is a
**glowing eye with no warhead**, and the strike drone is a **blunt warhead nose
with no eye ring**. Size does the rest: 40 px vs 30 px on field.

---

## Observer drone — `drone-player.png`

The side's mobile "eye" — the unit the camera follows. Unarmed, so the dorsal
center is a camera gimbal, not a mount. On field at **40 px** (a touch under a
robot's 46).

```text
Top-down (bird's-eye) game sprite of a small fast reconnaissance quad-rotor
surveillance drone for a retro-futuristic RTS, viewed from directly above and
pointing straight up. A compact rounded central body with four slender arms
splayed out in an X, each ending in a spinning rotor shown as a soft translucent
motion-blurred disc. In the dead center of the body, a prominent gimbal-mounted
camera lens / glowing cyan optical eye looking straight down, the drone's defining
feature. Sleek allied faction design: cool blue and teal brushed-steel body with
white and bright cyan accent lines, a small hexagon chevron insignia, and a faint
cyan sensor glow. Light, nimble, clearly airborne — not a wheeled or tracked
ground unit. A small forward-pointing nose/antenna marks its facing. Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting with
subtle rim light. Fully transparent background, no ground, no shadow, no text.
Centered, filling about 75% of a 512x512 frame with even padding so the rotor
discs never clip when it rotates in-game.
```

---

## FPV strike drone — `fpv-munition.png`

The single-use munition launched by the
[FPV carrier module](weapons.md#fpv--loitering-munition-carrier-module-launches-a-swarm-of-strike-drones):
**five leave the pod at once**, fly to one target, hit it once, and are gone. On
field at **30 px** — deliberately smaller than the observer, because a swarm of
five must never outweigh the robot that fired it.

Three things the picture has to say at 30 px, in this order:

1. **It is a weapon.** A blunt shaped-charge warhead nose fills the dorsal
   center where the observer has its camera eye — no lens, no glowing optic, no
   sensor ring. That single swap is what tells the player which flyer this is.
2. **It is cheap and disposable.** Bare frame arms, exposed wiring, a stubby
   battery pack taped on — a hobby airframe with a bomb on it, not the sleek
   machined body of the observer.
3. **It is fast.** Slightly elongated along its facing (unlike the observer's
   symmetric X), so the swarm reads as pointed *at* something even when still.

Authored facing **up (north)** like the observer → `rotationOffset: Math.PI / 2`.

```text
Top-down (bird's-eye) game sprite of a small single-use FPV kamikaze strike drone
for a retro-futuristic RTS, viewed from directly above and pointing straight up. A
crude lightweight quad-rotor airframe: a narrow elongated carbon-fiber body with
four thin exposed arms in an X, each ending in a small spinning propeller shown as
a soft translucent motion-blurred disc, with visible zip-tied wiring and a stubby
battery pack strapped along the spine. In the dead center, strapped to the top of
the frame, a blunt conical shaped-charge warhead with a yellow-and-black hazard
band and a tiny blinking red arming light — the drone's defining feature. A short
forward-pointing FPV camera stub and a thin whip antenna at the nose mark its
facing. NO gimbal camera, no large glowing optical eye, no sensor ring — this is a
weapon, not a scout. Cool blue and teal accents on bare grey composite, deliberately
cheap and disposable-looking rather than sleek. Light, fast, clearly airborne — not
a ground vehicle. Bold readable silhouette that stays legible when five of them fly
in a cluster, semi-flat stylized art with light cel shading, soft top lighting with
subtle rim light. Fully transparent background, no ground, no shadow, no text, no
smoke and no exhaust trails. Centered, filling about 75% of a 512x512 frame with even
padding so the propeller discs never clip when it rotates in-game.
```

---

## Wiring the generated art into the game

Both flyers follow the same three steps; only the names and numbers differ.

1. Export as a transparent PNG into `client/assets-src/sprites/`
   (`drone-player.png` / `fpv-munition.png`), add it to the `SPRITES` table in
   `client/scripts/encode-sprites.mjs`, then run `node scripts/encode-sprites.mjs`
   — that writes the `public/*.webp` the game actually loads (see
   [README.md](README.md#where-the-files-live-masters-vs-what-ships)). Both are
   drawn at 30–40 px, so `size: 64` is already generous.
2. Register it in `src/config/sprites.ts`, authored facing up →
   `rotationOffset: Math.PI / 2`:
   ```ts
   export const droneSprite: SpriteDef | undefined = {
     src: '/drone-player.webp',
     rotationOffset: Math.PI / 2,
     targetSize: 40,
   };

   export const munitionSprite: SpriteDef | undefined = {
     src: '/fpv-munition.webp',
     rotationOffset: Math.PI / 2,
     targetSize: 30,
   };
   ```
   Add each `src` to `spriteSources()` so it preloads, add a
   `getDroneTexture()` / `getMunitionTexture()` to `src/pixi/assets.ts` (mirror
   `getRobotTexture`), and have `src/pixi/render/DroneView.ts` /
   `MunitionView.ts` draw the `Sprite` when the texture resolves, falling back to
   the Graphics placeholder otherwise.
3. Keep both on the `overlay` layer with `container.eventMode = 'none'` so the art
   (and the observer's sight-zone ring) never intercepts pointer clicks — and so a
   swarm crossing the field can't swallow a click meant for a robot underneath it.

## Per-image checklist before accepting a generation

- [ ] Transparent background (no white box, no shadow, no ground).
- [ ] Pointing straight up, perfectly top-down (no perspective tilt).
- [ ] Centered with padding; rotor discs not touching the frame edge.
- [ ] Strong silhouette, obviously a flyer, at its on-field size (40 px / 30 px).
- [ ] **Observer:** central camera/eye is the focal point; no warhead anywhere.
- [ ] **FPV:** central warhead is the focal point; no camera gimbal, no eye glow.
- [ ] The two are unmistakable side by side at 100% zoom, tinted the same colour.
