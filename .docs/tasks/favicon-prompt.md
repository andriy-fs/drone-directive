# Prompt: generate the favicon for "Drone Directive"

> Copy the fenced block under [The prompt](#the-prompt) into an image/vector generator. Everything
> around it is why the constraints are what they are, and what to do with what comes back.

Sits in `.docs/tasks/` rather than `.docs/sprites/` on purpose: a favicon is not a game object. It
obeys none of the [shared sprite spec](../sprites/README.md#shared-spec-applies-to-every-prompt--do-not-vary)
— not top-down, not transparent, not 512², not facing north — because it is never drawn on the
field. It is a 16 px glyph in a browser tab.

## Status: done

The prompt below produced `client/assets-src/favicon.png` (500², transparent, variant 1 — the
overhead quad-drone), which `client/scripts/encode-favicon.mjs` turns into what the site serves.
The rest of this document is kept as the brief: it is the spec the current icon is measured
against, and what to hand a generator if it is ever redone.

## What was there before, and why it went

`client/public/favicon.svg` used to be a leftover: a purple lightning bolt in `#863bff` / `#7e14ff` /
`#47bfff`, built from ~15 blurred ellipses behind an alpha mask, with `color(display-p3 …)` fills.
Three separate problems:

- **It is not this game.** A bolt says "fast" or "power". Drone Directive is about *standing orders
  given to machines* — the player programs units and watches them execute. Nothing in the mark
  points at that.
- **It is off-palette.** Purple `#863bff` appears nowhere in `client/src/config/palette.ts`. The
  game's own accent for "you" is blue `#3b82f6`; `#a855f7` exists only as the *third opponent's*
  colour, i.e. an enemy.
- **It cannot survive 16 px.** Fifteen `feGaussianBlur` ellipses inside a mask resolve to mud at tab
  size, and the fine notches of the bolt close up entirely.

## Hard constraints

- **One shape, readable at 16×16.** This is the only rule that really matters. Design *at* 16 px and
  scale up, not the reverse. No text, no lettering, no thin strokes, no gradients-as-detail.
- **Palette, from `client/src/config/palette.ts`** — the same values the game draws with:
  | Role | Hex | Where it comes from |
  | --- | --- | --- |
  | Ground / plate | `#0d1117` | `palette.background`, and the boot screen in `index.html` |
  | The mark | `#3b82f6` | `palette.owner.player` — "your side" |
  | Optic / accent | `#22d3ee` | `palette.drone.body` — the observer drone's eye |
  | Optional edge | `#232a36` | the UI border token |

  No purple, no red — those are opponent colours in this game and read as hostile.
- **Carry contrast on white *and* on near-black.** Tabs, bookmark bars and OS launchers sit on
  everything in between. The prompt asks for an opaque dark plate because that guarantees it; the
  icon that shipped is instead a **transparent** mark whose mass is mid-blue `#3b82f6`, which reads
  on both — its dark outline is what disappears against a dark tab, and the outline is not what
  makes it recognisable. Either answer is acceptable; a *dark* transparent silhouette is not.
  (The Apple touch icon is flattened onto the plate regardless — iOS composites transparency onto
  black.)
- **Full bleed.** The mark occupies ~70–80% of the plate. A sprite's generous padding is wasted here
  — nothing rotates, and every pixel is expensive.
- **Flat, two or three colours total.** No blur filters, no drop shadow, no photorealism, no bevel.
- **Square, 1:1.** No wordmark lockup, no tagline, no mockup of a browser tab around it.

## The concept

The mark should say **"a directive, issued to a machine"** — the game's actual verb. Three
silhouettes are worth generating; pick after the 16 px squint test, they are listed in the order
they are most likely to survive it:

1. **Overhead quad-drone.** A blunt X of four thick arms, rounded rotor discs at the tips, one
   bright cyan circular optic dead centre. Reads instantly as a drone, matches
   [`drone.md`](../sprites/drone.md), and the centre optic gives the icon a focal point at any size.
2. **Directive chevron in a hex.** A blue hexagon plate — the allied insignia already specified in
   the faction language — with a single bold chevron/arrow pointing up through it. Abstract, the
   most logo-like, the most legible of the three at 16 px.
3. **Command node.** One filled centre dot with three short thick spokes ending in smaller dots — an
   order propagating outward to units. The most conceptual, the most likely to read as a generic
   network icon; only pick it if the first two come back weak.

## The prompt

```text
A minimal, flat vector app icon for a sci-fi real-time-strategy game called
"Drone Directive". Square 1:1, a solid dark rounded-square plate in near-black
#0d1117 with corner radius about 18% of the side, fully opaque, edge to edge.

Centered on the plate, filling about 75% of it: a bold, simplified top-down
quad-rotor drone seen from directly above, in flat blue #3b82f6 — a compact
rounded body with four thick stubby arms in an X, each ending in a solid round
rotor disc, and one single bright cyan #22d3ee circular optic lens in the dead
center of the body as the focal point.

Style: flat 2-color vector, geometric, chunky, heavy solid shapes with generous
spacing between them, high contrast against the dark plate, no outline thinner
than 1/16 of the icon width. Absolutely no gradients, no blur, no glow, no drop
shadow, no bevel, no 3D, no texture, no photorealism, no text or letters, no
background scenery.

It must stay instantly recognizable when scaled down to 16x16 pixels — design it
as a favicon, prioritizing silhouette clarity over detail. Deliver as clean SVG
with as few paths as possible.
```

For variants 2 and 3, replace the second paragraph with:

```text
[hex badge] Centered, filling about 75% of the plate: a solid blue #3b82f6
regular hexagon standing on a flat edge, with a single bold upward-pointing
chevron cut out of it in the dark plate colour, and a small bright cyan #22d3ee
dot at the chevron's apex.
```

```text
[command node] Centered, filling about 75% of the plate: one large solid cyan
#22d3ee filled circle, with three thick blue #3b82f6 spokes radiating outward at
120-degree intervals, each ending in a smaller solid blue dot. Chunky and
symmetric, like a signal propagating outward.
```

Negative prompt, if the tool takes one:

```text
text, letters, numbers, wordmark, gradient, glow, blur, drop shadow, bevel, 3D
render, glossy, metallic reflection, photorealistic, thin lines, fine detail,
busy composition, purple, red, orange, transparent background, browser mockup,
multiple icons in a grid, watermark
```

## After generating

1. **Squint test first.** Render at 16 px and look at it next to a dozen real tabs before doing any
   other work. If the optic closes up or the arms merge, thicken and re-render; do not proceed with
   a mark that fails here.
2. **Drop the master at `client/assets-src/favicon.png`** — outside `public/`, like every other
   master (see the sprite [README](../sprites/README.md#where-the-files-live-masters-vs-what-ships)).
   Transparent PNG, any square size from ~256² up; generator padding is fine, step 3 measures it and
   throws it away.
3. **Run `node scripts/encode-favicon.mjs` from `client/`** and commit what it writes:
   | File | What it is |
   | --- | --- |
   | `public/favicon.ico` | 16/32/48 px, PNG entries, transparent — the tab icon |
   | `public/apple-touch-icon.png` | 180 px, **opaque** on `#0d1117` — iOS home screen |

   Both are already linked from `client/index.html`; nothing needs editing unless a filename
   changes. The script re-pads the mark to 90% of the frame (72% for the touch icon, which iOS
   rounds and masks itself) and premultiplies before scaling, without which a 500→16 px downscale
   fringes the edges with black.
4. **A `.svg` icon is optional and is not generated.** Tracing a raster into SVG produces a
   thousand-node blob that is bigger than the `.ico` and no crisper; the only worthwhile SVG is one
   redrawn by hand from the geometry (four discs, an X of two bars, a body, an optic — a dozen
   paths). If that is ever done, it ships *alongside* the `.ico`:
   ```html
   <link rel="icon" href="/favicon.ico" />
   <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
   ```
   and it must carry no `<filter>`, no `<mask>` and no `color(display-p3 …)` fill — all three of
   which are what made the old one unusable.

## Acceptance checklist

- [x] Recognisable at 16 px, in a row of other favicons, without being told what it is.
- [x] Reads on a white tab bar and on a black one.
- [x] Only palette colours; nothing purple, red or orange.
- [x] Square, no padding wasted — the encoder re-pads the mark to 90% of the frame.
- [x] `favicon.ico` under 8 KB, `apple-touch-icon.png` opaque.
- [x] Sits alongside the title-screen art without looking like a different product.
