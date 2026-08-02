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
they depict** — the walker and tracked chassis from [robots.md](robots.md), the
quad-rotor eye from [drone.md](drone.md), the enemy war factory from
[bases.md](bases.md) — so the splash and the battlefield behind it agree. Re-sync
those phrases if a unit's art is redesigned.

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
- **Subjects: only units that exist in the game.** The allied walker (`legs`) and
  tracked (`tracks`) chassis, the observer drone, and the enemy base — drawn from
  the same descriptions as their sprites. No infantry, no aircraft, no vehicles
  the game doesn't have.
- **No text.** No title, no logo, no interface, no watermark, no border — the menu
  renders its own title over the image.
- **Style:** clean stylized retro-futuristic RTS **key art**, semi-flat with light
  cel shading and atmospheric haze — not photoreal, not pixel-art.

## Prompt

```text
Cinematic key-art splash screen for a retro-futuristic top-down RTS, drawn as a
wide 16:9 landscape illustration. A low three-quarter camera close to the ground,
looking across a dark war-torn battlefield under a heavy overcast night sky.

In the left third of the frame, in the foreground, a tall allied armored walker
mech on articulated legs stands facing away into the field — sleek allied faction
design: cool blue and teal armor plating with brushed-steel edges and clean cyan
accent lines, a glowing cyan optic and a hexagon chevron insignia on its carapace,
a flat circular weapon hardpoint on the top of the hull. Just behind it, smaller
and partly in shadow, a heavy tracked allied battle robot on two thick caterpillar
tracks. Above and slightly left, a small quad-rotor observer drone hovers — four
slender arms splayed in an X, rotors as soft translucent motion-blurred discs, a
glowing cyan camera eye underneath, its light catching the mech's shoulder.

The ground is packed charcoal earth and ash with faint hairline cracks, scattered
fine gravel and worn scorch marks, running back to a low flat horizon. In the right
third, far in the background, the silhouette of a hostile enemy war factory: a
brutal angular fortress of gunmetal plating with red and orange panels, jagged
antenna masts, smokestacks and glowing red vents, a menacing red beacon, with faint
red light and thin smoke bleeding into the haze around it.

The middle of the image is deliberately empty — open ground and low atmospheric haze
between the allied units on the left and the enemy stronghold on the right, with no
subject, no bright light and no fine detail in the central vertical strip.

Colour: the same very dark, muted, desaturated palette as the battlefield itself —
deep charcoals and dark blue-grays anchored on #0d1117, cool blue and cyan glow on
the allied machines, hostile red and orange glow on the enemy side, and nothing else
saturated. Overall very dark and low contrast, no bright sky, no moon, no sunburst,
no strong highlight anywhere near the centre of the frame, so light interface text
stays perfectly readable over the image.

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

1. Export at **1920×1080** and save it as **`client/public/menu-backdrop.webp`** —
   WebP at quality ≈80, aim for **≤ ~400 KB**. A full-frame illustration as PNG runs
   to several megabytes (compare `ground-tile.png` at 1.6 MB), and this one is on the
   critical path of the very first paint.
2. Register the path in `client/src/config/sprites.ts` beside the sprite maps — a
   plain string, not a `SpriteDef`, and built off the same `PUBLIC_BASE` so it keeps
   working under the production `base: './'` (GitHub Pages):
   ```ts
   export const menuBackdropSrc = `${PUBLIC_BASE}menu-backdrop.webp`;
   ```
3. `MainMenu` passes it to its `.dialog-backdrop--splash` element as the
   `--splash-image` custom property; `App.css` composites it under the scrim
   gradient, over `var(--bg)`. A missing file degrades to the flat `#0d1117`
   background — the menu still works, it just isn't pretty.

## Per-image checklist before accepting a generation

- [ ] 16:9 landscape, full-bleed, no border or letterboxing.
- [ ] Central vertical strip is quiet — nothing important behind a 420 px panel.
- [ ] Dark and low-contrast enough that near-white text reads over it everywhere.
- [ ] No text, logo, UI or watermark anywhere in the frame.
- [ ] Palette matches the field art: `#0d1117` charcoals, blue/cyan allies, red enemy.
- [ ] The machines match the actual sprites (walker, tracks, quad-rotor drone, enemy base).
- [ ] Survives a portrait crop — the allied mech still in frame at 9:16.
