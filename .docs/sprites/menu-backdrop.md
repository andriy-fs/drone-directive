# Menu backdrop prompt

A prompt for the **title-screen splash art** — the single full-viewport image the
player sees before a match starts, with the main menu panel floating over it.
Until this art existed the menu was a translucent panel over the **live game
field**; now nothing of the world is built before Start, so this image is all
there is behind the menu.

This asset is **key art, not a game object**, so it overrides more of the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary) than any
other prompt here: it is **not top-down**, **not square**, **not transparent** and
**not centered on one subject**. What it does keep — and what makes it look like
the same game — is everything else: the
[faction visual language](README.md#faction-visual-language-this-is-how-enemies-look-different),
the near-black `#0d1117` palette of [ground.md](ground.md), and the stylized
semi-flat cel-shaded RTS style.

The machines in the prompt are described with the **same wording as the sprites
they depict** — all three chassis from [robots.md](robots.md), the quad-rotor eye
from [drone.md](drone.md), the cannon module from [weapons.md](weapons.md), the
enemy war factory from [bases.md](bases.md) — so the splash and the battlefield
behind it agree. Re-sync those phrases if a unit's art is redesigned.

**The walker is a six-legged siege platform, not a biped.** This is the mistake
the first accepted backdrop made: it showed a tall two-legged mech, a silhouette
that exists nowhere in the game. `legs` is the heaviest chassis — a broad armored
hull about two thirds the unit's width, carried on **exactly six short, thick,
heavily armored legs, three per side**, the mass in the hull and not in the limbs
(see [robots.md → Legs](robots.md#legs--armored-walker-mech), which spells out why
a spider silhouette is wrong). At the backdrop's low camera it is **squat and wide,
lower than it is broad** — closer to a tank on legs than to a mech that towers over
the frame.

## Backdrop-specific spec

- **View:** a **low cinematic three-quarter camera** near ground level, looking
  across the battlefield. This is the **only** asset in the set that is not
  bird's-eye: it is never composited into the field, it only ever sits behind the
  menu, so the strict top-down rule doesn't apply.
- **Aspect / canvas:** **16:9 landscape, 1920×1080** — every other asset here is
  square. It is painted across the whole viewport with `cover`, so it **will be
  cropped**: the sides go on a portrait phone, the top and bottom on an ultrawide.
- **Safe zone:** the menu panel is `min(92vw, 420px)` wide and up to `88vh` tall,
  dead-centre. Keep the **central ~30% column quiet** — open ground and haze, no
  subject, no fine detail. Put the focal elements in the left and right thirds but
  still **inside the middle 70% of the width**, so a portrait crop keeps them, and
  put nothing important in the outer 15% or the top 10%.
- **Value range — darker than you think.** A scrim of `rgba(5,8,13,0.5)` →
  `rgba(5,8,13,0.78)` is laid over the image and near-white UI text (`#eef2f7`)
  sits on top of that. The art must **already** be dark and low-contrast: no bright
  sky, no moon, no sun, no muzzle flash, and **no bright highlight anywhere near
  the centre of the frame**.
- **Palette — identical to the rest of the set.** Deep charcoals and dark
  blue-grays anchored on `#0d1117`; cool **blue/teal/cyan** glow on the allied
  machines, hostile **red/orange** glow on the enemy side. Nothing else saturated.
- **Subjects: only units that exist in the game.** All three allied chassis —
  the six-legged walker (`legs`), the tracked tank (`tracks`) and the wheeled
  buggy (`wheels`) — plus the observer drone and the enemy base, drawn from the
  same descriptions as their sprites. No bipedal mechs, no infantry, no aircraft,
  no vehicles the game doesn't have.
- **Weapons are modules, not built-in guns.** A robot's gun is a separate part
  bolted to a flat circular hardpoint in the middle of its deck. If the key art
  arms anything, it is one plain **cannon module** — a single thick brass barrel
  on a dark gunmetal breech, no faction colour on the gun itself, and **not
  firing**.
- **No text.** No title, no logo, no interface, no watermark, no border — the menu
  renders its own title over the image.
- **Style:** clean stylized retro-futuristic RTS **key art**, semi-flat with light
  cel shading and atmospheric haze — not photoreal, not pixel-art.

## Prompt

```text
Cinematic key-art splash screen for a retro-futuristic top-down RTS, drawn as a
wide 16:9 landscape illustration. A low three-quarter camera close to the ground,
looking across a dark war-torn battlefield under a heavy overcast night sky.

In the left third of the frame, in the foreground, an allied six-legged armored
siege walker stands facing away into the field. It is NOT a humanoid or bipedal
mech: it is a massive low-slung machine whose broad armored body is the whole
silhouette, as wide and solid as a tank hull, carried on exactly SIX short, thick,
heavily armored articulated legs — three down its left side and three down its
right, splayed out like a beetle's, each stubby and piston-like rather than long
and spidery, planted on the ground. It is wider than it is tall, squat and heavy,
hunkered close to the earth, and it does not tower over the frame. Sleek allied
faction design: cool blue and teal armor plating with brushed-steel edges and clean
cyan accent lines, a glowing cyan optic and a hexagon chevron insignia on its
carapace. On a flat circular hardpoint in the middle of its top deck sits a bolted-on
cannon module — one thick brass gun barrel on a chunky dark gunmetal breech, not
firing.

Just behind it, smaller and partly in shadow, a heavy allied tracked battle robot:
a boxy sturdy hull sitting low between two thick caterpillar tracks, with the same
blue and teal plating and its own circular deck hardpoint. Above and slightly left,
a small quad-rotor observer drone hovers — a compact rounded body with four slender
arms splayed in an X, rotors as soft translucent motion-blurred discs, a glowing
cyan gimbal camera eye looking down, its light catching the walker's carapace.

The ground is packed charcoal earth and ash with faint hairline cracks, scattered
fine gravel and worn scorch marks, running back to a low flat horizon. In the right
third, at middle distance, a light allied wheeled combat buggy drives away from the
camera toward the enemy line — a lean angular open-frame chassis on chunky rugged
off-road wheels, small in the frame, blue and teal with a faint cyan glow, kicking
up a thin trail of dust. Far behind it, in the right third of the background, the
silhouette of a hostile enemy war factory: a brutal angular fortress of gunmetal
plating with red and orange panels, jagged antenna masts, smokestacks and glowing
red vents, a menacing red beacon, with faint red light and thin smoke bleeding into
the haze around it.

The middle of the image is deliberately empty — open ground and low atmospheric haze
between the allied units on the left and the enemy stronghold on the right, with no
subject, no bright light and no fine detail in the central vertical strip.

Colour: the same very dark, muted, desaturated palette as the battlefield itself —
deep charcoals and dark blue-grays anchored on #0d1117, cool blue and cyan glow on
the allied machines, hostile red and orange glow on the enemy side, and nothing else
saturated. Overall very dark and low contrast, no bright sky, no moon, no sunburst,
no strong highlight anywhere near the centre of the frame, so light interface text
stays perfectly readable over the image.

Only machines that belong to this army: a six-legged walker, a tracked tank and a
wheeled buggy. No bipedal or humanoid mech, no two-legged robot, no arms, hands,
head or cockpit canopy, no infantry, no tanks with turrets and gun mantlets, no
aircraft, no helicopters, no spacecraft.

No text, no title, no logo, no user interface, no watermark, no border, no frame.
Fills the whole image edge to edge.

Stylized semi-flat retro-futuristic RTS game key art, clean geometric shapes,
light cel shading, bold readable forms rather than fine detail, atmospheric haze.

Wide landscape image, 1920x1080.
```

## How the backdrop is wired up

Unlike every other asset here, this one **never enters the Pixi asset cache** — the
menu is React/DOM, so the image is a CSS background on the menu's own dialog
backdrop. It is therefore deliberately **absent from `spriteSources()`**: preloading
it into the WebGL texture cache would cost VRAM for something Pixi never draws.

1. Export at **1920×1080** into `client/assets-src/` as the master, then encode
   **`client/public/menu-backdrop.webp`** with `cwebp -q 93 -m 6` and aim for
   **≤ ~250 KB**. It is on the critical path of the very first paint — the page
   preloads it from `index.html` — so **lossy, never lossless**: the first shipped
   version was lossless VP8L and cost 1.1 MB for the same picture that lossy q93
   stores in 205 KB. The art is dark with wide smooth gradients, which is the worst
   case for banding, so do not drop below q90.
2. Register the path in `client/src/config/sprites.ts` beside the sprite maps — a
   plain string, not a `SpriteDef`, and built off the same `PUBLIC_BASE` so there is
   one place that knows where public files live:
   ```ts
   export const menuBackdropSrc = `${PUBLIC_BASE}menu-backdrop.webp`;
   ```
3. `MainMenu` passes it to its `.dialog-backdrop--splash` element as the
   `--splash-image` custom property; `App.css` composites it under the scrim
   gradient, over `var(--bg)`. A missing file degrades to the flat `#0d1117`
   background — the menu still works, it just isn't pretty.

### The social card is cropped from the same master

`client/public/social-card.jpg` is the `og:image` in `index.html`. It exists as its
own file because Open Graph wants **1.91:1** and this art is 16:9 — handing the
backdrop straight to an unfurler lets the platform crop it, and the platform does
not know the walker and the enemy factory are the subject. Regenerate it whenever
the backdrop changes:

```bash
cd client
ffmpeg -y -i assets-src/menu-backdrop.png \
  -vf "crop=1672:878:0:55,scale=1200:630:flags=lanczos" -q:v 4 public/social-card.jpg
```

The crop takes its height almost entirely off the top: that band is empty sky,
while the machines sit low against the horizon. JPEG, not WebP — every unfurler
handles it, and at ~80 KB the format costs nothing here. Keep it under ~300 KB
(some crawlers skip larger) and keep the dimensions in the `og:image:width` /
`og:image:height` tags in step, since unfurlers trust those before fetching.

## Per-image checklist before accepting a generation

- [ ] 16:9 landscape, full-bleed, no border or letterboxing.
- [ ] Central vertical strip is quiet — nothing important behind a 420 px panel.
- [ ] Dark and low-contrast enough that near-white text reads over it everywhere.
- [ ] No text, logo, UI or watermark anywhere in the frame.
- [ ] Palette matches the field art: `#0d1117` charcoals, blue/cyan allies, red enemy.
- [ ] The machines match the actual sprites (six-legged walker, tracks, wheels,
      quad-rotor drone, enemy base).
- [ ] **Count the legs:** exactly six on the walker, three a side. No biped.
- [ ] The walker is squat and hull-heavy — body wider than the leg span is tall,
      not a spider and not a towering mech.
- [ ] Any gun is a module sitting on a circular deck hardpoint, and it isn't firing.
- [ ] Survives a portrait crop — the walker still in frame at 9:16.
