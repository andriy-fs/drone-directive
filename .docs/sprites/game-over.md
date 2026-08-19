# Game-over splash prompts

Prompts for the **end-of-match key art** — three full-viewport images, one per
outcome, shown behind the game-over modal the way
[menu-backdrop.md](menu-backdrop.md)'s art sits behind the main menu. Until these
existed, the modal opened over the frozen battlefield behind a flat
`rgba(5,8,13,0.68)` wash, so winning and losing looked identical apart from the
colour of the title.

| Asset                 | Outcome                    | Wired up?                                    |
| --------------------- | -------------------------- | -------------------------------------------- |
| `game-over-victory`   | the player won             | yes — `GameOverModal`                        |
| `game-over-defeat`    | the player lost            | yes — `GameOverModal`                        |
| `game-over-abandoned` | the opponent left the match | **no** — art only, waiting on Technical Loss |

`game-over-abandoned` is generated ahead of the screen that will show it. Today a
disconnect ends the session, drops back to the title screen and prints a line of
text in `OnlinePanel`; the Technical Loss feature will give it an outcome screen,
and this is the art it should use.

Like the menu backdrop, these are **key art, not game objects**, so they override
the same parts of the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary): **not
top-down**, **not square**, **not transparent**, **not centered on one subject**.
Everything that makes them look like the same game is kept — the
[faction visual language](README.md#faction-visual-language-this-is-how-enemies-look-different),
the near-black `#0d1117` palette of [ground.md](ground.md), and the stylized
semi-flat cel-shaded style.

The machines are described with the **same wording as the sprites they depict**,
copied from [menu-backdrop.md](menu-backdrop.md) so all four pieces of key art
agree; re-sync all of them together if a unit is redesigned. In particular the
walker warning at the top of that file applies verbatim here: **`legs` is a
six-legged siege platform, not a biped and not a spider** — a broad armored hull
about two thirds of the unit's width on **exactly six short, thick, heavily
armored legs, three per side**, squat and wider than it is tall.

## Backdrop-specific spec

- **View:** a **low cinematic three-quarter camera** near ground level, looking
  across the battlefield — the same camera as the menu backdrop, so the four
  images read as one set. Never bird's-eye: none of these is composited into the
  field.
- **Aspect / canvas:** **16:9 landscape, 1920×1080**. Painted across the whole
  viewport with `cover`, so it **will be cropped**: the sides go on a portrait
  phone, the top and bottom on an ultrawide.
- **Safe zone:** the modal is `min(92vw, 420px)` wide and up to `88vh` tall,
  dead-centre. Keep the **central ~30% column quiet** — open ground and haze, no
  subject, no fine detail. Put the focal elements in the left and right thirds but
  still **inside the middle 70% of the width**, so a portrait crop keeps them, and
  put nothing important in the outer 15% or the top 10%.
- **Value range — darker than you think, and this is where a battle scene fails.**
  A scrim of `rgba(5,8,13,0.5)` → `rgba(5,8,13,0.78)` is laid over the image and
  near-white UI text (`#eef2f7`) sits on top of that. Destruction is the subject
  of two of these three images and the reflex for destruction is fire, which is
  exactly what must not happen: **no flames, no fireball, no explosion, no muzzle
  flash, no bright sky, no moon or sun**, and **no bright highlight anywhere near
  the centre of the frame**. Burning wreckage reads as dull deep-red embers and
  slow smoke — a dim silhouette, never a light source.
- **Palette — identical to the rest of the set.** Deep charcoals and dark
  blue-grays anchored on `#0d1117`; cool **blue/teal/cyan** on the allied
  machines, hostile **red/orange** on the enemy side. Nothing else saturated.
  Which of the two dominates is how the outcome reads at a glance: cyan for
  victory, red for defeat, neither for abandoned.
- **Subjects: only units that exist in the game.** The six-legged walker (`legs`),
  the tracked tank (`tracks`), the wheeled buggy (`wheels`), the quad-rotor
  observer drone, and the two bases — drawn from the same descriptions as their
  sprites. No bipedal mechs, no infantry, no aircraft, no human figures.
- **Weapons are modules, not built-in guns.** A robot's gun is a separate part
  bolted to a flat circular hardpoint in the middle of its deck. If anything is
  armed it is one plain **cannon module** — a single thick brass barrel on a dark
  gunmetal breech, no faction colour on the gun itself, and **not firing**.
- **No text.** No title, no logo, no interface, no watermark, no border — the
  modal renders its own title over the image.
- **Style:** clean stylized retro-futuristic RTS **key art**, semi-flat with light
  cel shading and atmospheric haze — not photoreal, not pixel-art.

## Prompt — victory (`game-over-victory`)

```text
Cinematic key-art splash screen for a retro-futuristic top-down RTS, drawn as a
wide 16:9 landscape illustration: the aftermath of a won battle. A low
three-quarter camera close to the ground, looking across a dark war-torn
battlefield under a heavy overcast night sky, in the quiet minutes after the
fighting stopped.

In the left third of the frame, in the foreground, an allied six-legged armored
siege walker stands intact, facing out across the field. It is NOT a humanoid or
bipedal mech: a massive low-slung machine whose broad armored body is the whole
silhouette, as wide and solid as a tank hull, carried on exactly SIX short, thick,
heavily armored articulated legs — three down its left side and three down its
right, stubby and piston-like rather than long and spidery, planted on the ground.
It is wider than it is tall, squat and heavy, hunkered close to the earth. Cool
blue and teal armor plating with brushed-steel edges, clean cyan accent lines, a
glowing cyan optic and a hexagon chevron insignia on its carapace, scuffed and
dusted from the fight but unbroken. On a flat circular hardpoint in the middle of
its top deck sits a bolted-on cannon module — one thick brass gun barrel on a
chunky dark gunmetal breech, barrel cooling, not firing. Beside it, a heavy allied
tracked battle robot sits low between two thick caterpillar tracks, same blue and
teal plating, its own circular deck hardpoint, idle.

Above and slightly left, a small quad-rotor observer drone hovers — a compact
rounded body with four slender arms splayed in an X, rotors as soft translucent
motion-blurred discs, a glowing cyan gimbal camera eye sweeping the field.

In the right third of the background stands the hostile enemy war factory,
defeated: a brutal angular fortress of gunmetal plating with red and orange panels,
now broken open — masts snapped and leaning, roof plates torn, one flank collapsed
into rubble, its red vents and beacon dark and dead. Only dull, deep-red embers
still glow low inside the wreck, and thick slow smoke drifts up from it into the
haze. It is a dim silhouette, not a fire: nothing about it is bright.

The ground between them is packed charcoal earth and ash with faint hairline
cracks, scattered gravel, worn scorch marks and a few dark burnt-out hulks of
destroyed enemy machines lying half-sunk in the dust, running back to a low flat
horizon. The middle of the image is deliberately empty — open ground and low
atmospheric haze between the allied units on the left and the ruined stronghold on
the right, with no subject, no bright light and no fine detail in the central
vertical strip.

Colour: very dark, muted, desaturated — deep charcoals and dark blue-grays anchored
on #0d1117, cool blue and cyan glow on the allied machines, dull red embers on the
enemy wreck, nothing else saturated. A faint cold cyan haze in the air on the
allied side. Overall very dark and low contrast, no bright sky, no moon, no
sunburst, no flames, no explosion, no strong highlight anywhere near the centre of
the frame, so light interface text stays perfectly readable over the image.

Only machines that belong to this army: a six-legged walker, a tracked tank and a
wheeled buggy. No bipedal or humanoid mech, no two-legged robot, no arms, hands,
head or cockpit canopy, no infantry, no turreted tanks, no aircraft, no
helicopters, no spacecraft, no human figures, no flags.

No text, no title, no logo, no user interface, no watermark, no border, no frame.
Fills the whole image edge to edge.

Stylized semi-flat retro-futuristic RTS game key art, clean geometric shapes, light
cel shading, bold readable forms rather than fine detail, atmospheric haze.

Wide landscape image, 1920x1080.
```

## Prompt — defeat (`game-over-defeat`)

```text
Cinematic key-art splash screen for a retro-futuristic top-down RTS, drawn as a
wide 16:9 landscape illustration: a lost battle. A low three-quarter camera close
to the ground, looking across a dark war-torn battlefield under a heavy overcast
night sky choked with smoke and drifting ash.

In the left third of the frame stands the allied command base, destroyed: a clean
rounded fortified structure of blue and teal armor plating with brushed-steel
edges and hexagon chevron insignia, now split open — walls buckled, plating peeled
back, one tower toppled across the rubble, its cyan lights dead except for a single
weak flickering cyan strip deep inside the wreck. Thick slow smoke rolls out of it.
In front of it, in the foreground, an allied six-legged armored siege walker lies
disabled and canted over onto one side, half of its six short thick armored legs
folded under it and the rest splayed out — three legs per side, stubby and
piston-like, NOT a humanoid or bipedal mech — its broad tank-wide hull scorched and
punctured, cyan optic dark, the bolted-on brass cannon module on its circular deck
hardpoint bent and silent. Beside it a wrecked allied tracked robot sits burnt out
between its two caterpillar tracks. A small quad-rotor observer drone lies broken
in the dust nearby, one of its four slender arms snapped, camera eye unlit.

Advancing from the right third at middle distance, hostile enemy machines close in
across the open ground: angular, spiked, heavily plated gunmetal war robots with
rust, scorch marks and hazard stripes, each with a single menacing red optic —
one tracked, one on six short thick legs, walking toward the ruined allied base,
small in the frame and half-lost in the haze. Far behind them, in the right third
of the background, the enemy war factory looms intact — a brutal angular fortress
of gunmetal plating with red and orange panels, jagged antenna masts, smokestacks
and glowing red vents, a menacing red beacon, red light and thin smoke bleeding
into the haze around it.

The ground is packed charcoal earth and ash, cracked and churned, littered with
debris and fine falling ash, running back to a low flat horizon. The middle of the
image is deliberately empty — open ground, smoke and low atmospheric haze between
the allied ruin on the left and the advancing enemy on the right, with no subject,
no bright light and no fine detail in the central vertical strip.

Colour: very dark, muted, desaturated — deep charcoals and dark blue-grays anchored
on #0d1117, dying cyan on the allied wreckage, hostile red and orange glow on the
enemy side, and a dull red cast bleeding into the smoke overhead. Nothing else
saturated. Overall very dark and low contrast, no bright sky, no moon, no sunburst,
no open flames, no explosion, no fireball, no strong highlight anywhere near the
centre of the frame, so light interface text stays perfectly readable over the
image.

Only machines that belong to this game: six-legged walkers, tracked tanks and
wheeled buggies. No bipedal or humanoid mech, no two-legged robot, no arms, hands,
head or cockpit canopy, no infantry, no turreted tanks, no aircraft, no
helicopters, no spacecraft, no human figures, no flags.

No text, no title, no logo, no user interface, no watermark, no border, no frame.
Fills the whole image edge to edge.

Stylized semi-flat retro-futuristic RTS game key art, clean geometric shapes, light
cel shading, bold readable forms rather than fine detail, atmospheric haze.

Wide landscape image, 1920x1080.
```

## Prompt — opponent left (`game-over-abandoned`)

```text
Cinematic key-art splash screen for a retro-futuristic top-down RTS, drawn as a
wide 16:9 landscape illustration: a battle that never happened — the enemy is
simply gone. A low three-quarter camera close to the ground, looking across a dark,
empty, undamaged battlefield under a heavy overcast night sky. Still, silent and
cold: no fighting has taken place here.

In the left third of the frame, in the foreground, an allied six-legged armored
siege walker stands idle and pristine, powered down to standby, facing out across
the empty field and waiting. It is NOT a humanoid or bipedal mech: a massive
low-slung machine whose broad armored body is the whole silhouette, as wide and
solid as a tank hull, carried on exactly SIX short, thick, heavily armored
articulated legs — three down its left side and three down its right, stubby and
piston-like rather than long and spidery, planted on the ground, wider than it is
tall, hunkered close to the earth. Cool blue and teal armor plating with
brushed-steel edges and clean cyan accent lines, a hexagon chevron insignia, its
cyan optic dimmed to a low idle glow. On a flat circular hardpoint in the middle
of its top deck sits a bolted-on cannon module — one thick brass barrel on a chunky
dark gunmetal breech, stowed and not firing. Beside it a heavy allied tracked
battle robot sits parked low between two thick caterpillar tracks, same plating,
unmoving.

Above and slightly left, a small quad-rotor observer drone hovers alone — compact
rounded body, four slender arms splayed in an X, rotors as soft translucent
motion-blurred discs, its cyan gimbal camera eye turned out toward the far side of
the field, scanning an enemy that is not there.

In the right third of the background, the hostile enemy war factory stands whole
but completely shut down and abandoned: a brutal angular fortress of gunmetal
plating with red and orange panels, jagged antenna masts and smokestacks — every
vent, every window and its beacon dark and cold, no red glow anywhere on it, no
smoke, its gates open and empty. It reads as a black silhouette against the haze.

The ground is unbroken packed charcoal earth and ash with faint hairline cracks,
scattered fine gravel, a few cold empty vehicle tracks leading away toward the
horizon and nothing else — no wreckage, no craters, no scorch marks, no debris. A
low flat horizon and thin drifting mist. The middle of the image is deliberately
empty — open ground and low atmospheric haze between the waiting allied machines
on the left and the dead factory on the right, with no subject, no bright light and
no fine detail in the central vertical strip.

Colour: very dark, muted, desaturated and notably colder than the rest of the set —
deep charcoals and dark blue-grays anchored on #0d1117, only a faint cyan idle glow
on the allied machines, and NO red or orange light anywhere in the frame. Overall
very dark, low contrast and emptier than a battle scene, no bright sky, no moon,
no sunburst, no fire, no explosion, no strong highlight anywhere near the centre of
the frame, so light interface text stays perfectly readable over the image.

Only machines that belong to this army: a six-legged walker, a tracked tank and a
wheeled buggy. No bipedal or humanoid mech, no two-legged robot, no arms, hands,
head or cockpit canopy, no infantry, no turreted tanks, no aircraft, no
helicopters, no spacecraft, no human figures, no flags.

No text, no title, no logo, no user interface, no watermark, no border, no frame.
Fills the whole image edge to edge.

Stylized semi-flat retro-futuristic RTS game key art, clean geometric shapes, light
cel shading, bold readable forms rather than fine detail, atmospheric haze.

Wide landscape image, 1920x1080.
```

## How these are wired up

Exactly like the menu backdrop and for the same reason: the modal is React/DOM, so
each image is a CSS background on the dialog's own backdrop element and **never
enters the Pixi asset cache**. They are therefore deliberately absent from
`spriteSources()` — preloading them into the WebGL texture cache would cost VRAM
for something Pixi never draws.

1. Export at 16:9 into `client/assets-src/` (beside `menu-backdrop.png`), named
   `game-over-victory.png`, `game-over-defeat.png`, `game-over-abandoned.png`.
   **Ask the generator for 1920×1080 but ship whatever it returns** — the three
   shipped images, like `menu-backdrop.png`, came back **1672×941**, and that is
   left alone: the art is only ever a `cover` background, so upscaling to hit a
   round number would cost bytes for pixels nobody sees. These are **not** in the
   `SPRITES` table of `client/scripts/encode-sprites.mjs`: that script handles
   square, Pixi-bound sprites out of `assets-src/sprites/`, and these are neither.
2. Encode by hand, **lossy, never lossless** — the art is dark with wide smooth
   gradients, the worst case for banding, so do not drop below q90:
   ```bash
   cd client
   for n in victory defeat abandoned; do
     cwebp -q 91 -m 6 assets-src/game-over-$n.png -o public/game-over-$n.webp
   done
   ```
   **q91, one step below the backdrop's q93**, because there are three of these
   and at q93 the two battle scenes came out at ~251 KB apiece; q91 puts them at
   198/195/140 KB — under `menu-backdrop.webp`'s 210 KB — for a PSNR still in the
   high 40s dB. Aim for **≤ ~250 KB** each and check the sky for banding after
   any change to the quality knob.
3. The paths are registered in `client/src/config/sprites.ts` as
   `gameOverBackdropSrc`, built off the same `PUBLIC_BASE` as `menuBackdropSrc`.
4. `GameOverModal` passes the outcome's URL to its `.dialog-backdrop--outcome`
   element as the `--splash-image` custom property; `App.css` composites it under
   a scrim gradient, over `var(--bg)`. A missing file degrades to the flat
   background — the modal still works, it just isn't pretty.
5. **No `<link rel="preload">` in `index.html`.** Unlike the menu backdrop these
   are nowhere near the first paint, and preloading them would compete with the
   bundle and the backdrop for the opening seconds. `App` warms the two wired
   images with `new Image()` once a match starts instead, so the modal does not
   open onto an empty backdrop after a long game. `abandoned` is not warmed —
   nothing shows it yet.

There is no social-card equivalent here: `og:image` is cropped from the menu
backdrop master only (see [menu-backdrop.md](menu-backdrop.md)).

## Per-image checklist before accepting a generation

- [ ] 16:9 landscape, full-bleed, no border or letterboxing.
- [ ] Central vertical strip is quiet — nothing important behind a 420 px panel.
- [ ] Dark and low-contrast enough that near-white text reads over it everywhere.
- [ ] **No fire.** No flames, fireball, explosion, muzzle flash or any bright
      light source — wreckage burns as dull embers and smoke only.
- [ ] No text, logo, UI or watermark anywhere in the frame.
- [ ] Palette matches the field art: `#0d1117` charcoals, blue/cyan allies, red enemy.
- [ ] The outcome reads from colour alone: cyan-dominant victory, red-dominant
      defeat, colourless abandoned.
- [ ] The machines match the actual sprites (six-legged walker, tracks, wheels,
      quad-rotor drone, the two bases).
- [ ] **Count the legs:** exactly six on the walker, three a side. No biped.
- [ ] The walker is squat and hull-heavy — body wider than the leg span is tall,
      not a spider and not a towering mech.
- [ ] Any gun is a module sitting on a circular deck hardpoint, and it isn't firing.
- [ ] Survives a portrait crop — the subject still in frame at 9:16.
- [ ] `abandoned` only: the field is genuinely **undamaged** — no wreckage, no
      craters, no scorch marks — and there is no red light anywhere in the frame.
