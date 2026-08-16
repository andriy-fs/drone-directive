# Robot sprite prompts

One prompt per **chassis × faction**. Every prompt already bakes in the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary); if you
edit the shared rules, re-sync the intro line of each block. Copy a fenced block
straight into Gemini / ChatGPT.

Reminder baked into each prompt: **top-down, facing straight up, transparent
background, 512×512, centered, one unit, clear central weapon hardpoint.**

**`legs` is the exception:** it ships as a four-phase walk-cycle sheet, so its
prompts ask for a 2×2 grid in a 1024×1024 frame and its still sprite is cut out
of that sheet. Everything else in the shared spec still applies per cell. See the
[Legs](#legs--armored-walker-mech) section for why.

---

## Tracks — heavy tracked tank

### Player (allied) — `robot-tracks-player.png`

```text
Top-down (bird's-eye) game sprite of a heavy armored tracked battle robot for a
retro-futuristic RTS, viewed from directly above and pointing straight up.
A boxy, sturdy hull sitting on two thick caterpillar tracks running down the
left and right sides. Sleek allied faction design: cool blue and teal armor
plating with brushed-steel edges and clean cyan accent lines, a small glowing
cyan optic and a hexagon chevron insignia on the hull. A clear flat circular
mount/hardpoint in the dead center of the top deck, left empty (a weapon will be
attached there later). Bold readable silhouette, semi-flat stylized art with
light cel shading, soft top lighting with subtle rim light. Fully transparent
background, no ground, no shadow, no text. Centered, filling about 80% of a
512x512 frame with even padding.
```

### Enemy (AI / hostile) — `robot-tracks-ai.png`

```text
Top-down (bird's-eye) game sprite of a heavy armored tracked battle robot for a
retro-futuristic RTS, viewed from directly above and pointing straight up.
A bulky, brutal hull on two heavy caterpillar tracks down the left and right
sides. Hostile enemy faction design: aggressive angular gunmetal-and-dark armor
with red and orange plating, spiked/armored edges, rust streaks, scorch marks
and yellow-black hazard stripes, a single menacing glowing red optic and a
jagged emblem. A clear flat circular mount/hardpoint in the dead center of the
top deck, left empty (a weapon will be attached there later). Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting
with subtle rim light. Fully transparent background, no ground, no shadow, no
text. Centered, filling about 80% of a 512x512 frame with even padding.
```

---

## Wheels — fast wheeled buggy/APC

### Player (allied) — `robot-wheels-player.png`

```text
Top-down (bird's-eye) game sprite of a fast lightweight wheeled combat buggy for
a retro-futuristic RTS, viewed from directly above and pointing straight up.
A lean, angular open-frame chassis on four to six rugged off-road wheels, built
for speed. Sleek allied faction design: cool blue and teal panels with
brushed-steel and white accents, cyan glow optic and a hexagon chevron insignia.
A clear flat circular mount/hardpoint in the dead center of the top deck, left
empty (a weapon will be attached there later). Bold readable silhouette,
semi-flat stylized art with light cel shading, soft top lighting with subtle rim
light. Fully transparent background, no ground, no shadow, no text. Centered,
filling about 80% of a 512x512 frame with even padding.
```

### Enemy (AI / hostile) — `robot-wheels-ai.png`

```text
Top-down (bird's-eye) game sprite of a fast lightweight wheeled combat buggy for
a retro-futuristic RTS, viewed from directly above and pointing straight up.
A jagged, aggressive open-frame chassis on four to six chunky spiked off-road
wheels, built for speed. Hostile enemy faction design: gunmetal and dark armor
with red and orange plating, angular spikes, rust streaks, scorch marks and
yellow-black hazard stripes, a single menacing glowing red optic and a jagged
emblem. A clear flat circular mount/hardpoint in the dead center of the top
deck, left empty (a weapon will be attached there later). Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting
with subtle rim light. Fully transparent background, no ground, no shadow, no
text. Centered, filling about 80% of a 512x512 frame with even padding.
```

---

## Legs — armored walker mech

**This is the one chassis generated as a walk-cycle sheet, not as a single sprite,
and the only prompt on this page that overrides the shared "one unit per image,
no variations grid" and "512×512" rules.**

Wheels and tracks hide their drive under the hull at this camera angle, so a
still sprite costs them nothing. Six legs are half of a walker's silhouette, and
`legs` is also the slowest chassis in the game (42 px/s), so it is the unit the
player watches march for longest — a mech sliding across the ground with rigid
legs is the most visible art bug on the field. `RobotView` flips through the four
cells by **distance travelled**, so the gait starts, matches pace and stops with
the unit itself.

Three consequences for the art, and they are the whole difficulty of this prompt:

- **The body may not move between cells.** The renderer swaps only the texture,
  so any drift of the carapace, the insignia or the hardpoint between cells shows
  up in game as the whole mech twitching. Only the legs change.
- **Exactly six legs, three per side, with visible background gaps between
  neighbours.** The old prompt said "four or six … splayed symmetrically", which
  is unposeable — a gait needs a known leg set. Without gaps the legs merge into
  one blob at 52 px and re-posing them reads as nothing at all.
- **The hull is wide and the legs are short.** See below — this is the rule that
  the first accepted generation broke, and it cost a full regeneration.

### The hull has to be wide enough to carry a weapon module

A weapon module is **30 px on every chassis** (`WEAPON_TARGET`), because
[weapons.md](weapons.md) budgets its whole detail and colour code against exactly
that size. So a chassis has to be wide enough to park one on. Measured across the
solid body through the sprite's centre, at each chassis's own on-field size:

| Chassis | solid hull under the module | module |
| ------- | --------------------------- | ------ |
| `tracks` | 30.9 px | 30 px |
| `wheels` | 28.9 px | 30 px |
| `legs` — first generation | **15.5 px** | 30 px |

The walker's torso came out **half the width of the module bolted to it**, so the
module overhung it by 7 px a side and hid the body completely — leaving thin legs
around a weapon, which is the opposite of the heaviest chassis in the game.

The same mistake shows up as **ink**: `tracks` and `wheels` fill ~86% of their
bounding box, the first walker filled 51%. It had the widest silhouette on the
field and the least mass in it.

So the walker is drawn as a **heavy siege platform, not a spider**:

- the armored body spans about **two thirds of the cell's width** — the same
  fraction a tank hull does;
- the central hardpoint circle is about **half the cell's width**;
- the six legs are **short, thick and heavily armored**, reaching only a little
  past the body. The mass is in the hull; the legs carry it, they are not the
  silhouette.

`LEGS_TARGET` (52 px, vs 46 for the other two) is the other half of the fix: the
walker is drawn bigger on the field because it is the 160 hp bruiser. Size alone
could not have fixed the overhang — matching the torso to a 30 px module by
scaling would have needed 89 px, nearly the size of a base.

### The four-phase cycle

Cell order below is reading order, which is the order `sheet2x2()` slices:
top-left → top-right → bottom-left → bottom-right.

| Cell | Pose | Role |
| ---- | ---- | ---- |
| 1 (top-left) | neutral stance, all six feet planted, sides symmetric | **the idle pose** + passing frame |
| 2 (top-right) | tripod A: front-left, middle-right, rear-left swung forward and lifted | full stride |
| 3 (bottom-left) | stance with the leg groups swapped — the mirror of cell 1 | passing frame |
| 4 (bottom-right) | tripod B: the exact mirror of cell 2 | full stride |

### The still sprite is a crop, not a generation

`robot-legs-player.png` / `robot-legs-ai.png` still ship (the units guide draws
them as a plain `<img>`, and they are the fallback when the sheet fails to load),
but they are **cut out of cell 1 of the accepted sheet** rather than generated
separately. Two independent generations drift in pose, lighting and line weight;
a crop cannot.

### Player (allied) — `robot-legs-player-gait.png`

```text
Top-down (bird's-eye) game sprite sheet for a walk cycle, drawn as a 2x2 grid of
four cells in a single 1024x1024 image, each cell a 512x512 square. Every cell
shows the SAME heavy armored walker mech for a retro-futuristic RTS, viewed from
directly above and pointing straight up, in a different phase of its stride.
PROPORTIONS, the most important thing about this unit: it is a massive siege
walker, not a spider. The broad armored body is the silhouette - it spans about
two thirds of the cell's width, as wide and solid as a tank hull. The flat
circular mount/hardpoint in the dead center of the top carapace is large, about
half the cell's width, and left completely empty (a weapon will be attached there
later). It is carried on exactly six SHORT, THICK, heavily armored articulated
legs, three down the left side and three down the right, reaching only a little
way past the body - stubby powerful pistons, not long thin spider limbs. Each leg
is still clearly separated from its neighbours by a visible gap of empty
background. The body must dominate: most of the unit's area is armored hull, not
gaps between legs. Sleek allied faction design: cool blue and teal armor plating
with brushed-steel edges and cyan accent lines, a glowing cyan optic and a
hexagon chevron insignia on the top carapace.
CRITICAL - the body must not move between cells: the central body, the carapace,
the insignia and the hardpoint are drawn at exactly the same position, the same
size and the same angle in all four cells, as if the camera and the body were
locked and only the legs were re-posed. Do not rotate, translate, rescale or
redesign the body between cells. Identical lighting, identical palette and
identical line weight in all four cells.
The four leg poses, in reading order:
1. top-left - neutral stance: all six feet planted, legs evenly splayed, left
   and right sides symmetric.
2. top-right - stride A: the front-left, middle-right and rear-left legs swung
   forward and lifted, the other three swept back and planted.
3. bottom-left - passing stance: all six feet planted again, but the leg groups
   swapped relative to cell 1, so it reads as the mirror of cell 1.
4. bottom-right - stride B: the exact mirror of cell 2 - front-right,
   middle-left and rear-right swung forward and lifted, the other three swept
   back and planted.
Bold readable silhouette, semi-flat stylized art with light cel shading, soft
top lighting with subtle rim light. Fully transparent background, no ground, no
shadow, no text, no labels, no grid lines, no frames or borders between cells.
Each mech centered inside its own cell, filling about 80% of it with even
padding, nothing touching or crossing a cell border. Must stay readable when
each cell is shrunk to 52 pixels.
```

### Enemy (AI / hostile) — `robot-legs-ai-gait.png`

```text
Top-down (bird's-eye) game sprite sheet for a walk cycle, drawn as a 2x2 grid of
four cells in a single 1024x1024 image, each cell a 512x512 square. Every cell
shows the SAME heavy armored walker mech for a retro-futuristic RTS, viewed from
directly above and pointing straight up, in a different phase of its stride.
PROPORTIONS, the most important thing about this unit: it is a massive siege
walker, not a spider. The broad armored body is the silhouette - it spans about
two thirds of the cell's width, as wide and solid as a tank hull. The flat
circular mount/hardpoint in the dead center of the top carapace is large, about
half the cell's width, and left completely empty (a weapon will be attached there
later). It is carried on exactly six SHORT, THICK, heavily armored articulated
legs, three down the left side and three down the right, reaching only a little
way past the body - stubby brutal pistons, not long thin spider limbs. Each leg
is still clearly separated from its neighbours by a visible gap of empty
background. The body must dominate: most of the unit's area is armored hull, not
gaps between legs. Hostile enemy faction design: aggressive angular
gunmetal-and-dark armor with red and orange plating, spiked carapace, rust
streaks, scorch marks and yellow-black hazard stripes, a single glaring red optic
and a jagged emblem.
CRITICAL - the body must not move between cells: the central body, the carapace,
the emblem and the hardpoint are drawn at exactly the same position, the same
size and the same angle in all four cells, as if the camera and the body were
locked and only the legs were re-posed. Do not rotate, translate, rescale or
redesign the body between cells. Identical lighting, identical palette, identical
rust and scorch placement and identical line weight in all four cells.
The four leg poses, in reading order:
1. top-left - neutral stance: all six feet planted, legs evenly splayed, left
   and right sides symmetric.
2. top-right - stride A: the front-left, middle-right and rear-left legs swung
   forward and lifted, the other three swept back and planted.
3. bottom-left - passing stance: all six feet planted again, but the leg groups
   swapped relative to cell 1, so it reads as the mirror of cell 1.
4. bottom-right - stride B: the exact mirror of cell 2 - front-right,
   middle-left and rear-right swung forward and lifted, the other three swept
   back and planted.
Bold readable silhouette, semi-flat stylized art with light cel shading, soft
top lighting with subtle rim light. Fully transparent background, no ground, no
shadow, no text, no labels, no grid lines, no frames or borders between cells.
Each mech centered inside its own cell, filling about 80% of it with even
padding, nothing touching or crossing a cell border. Must stay readable when
each cell is shrunk to 52 pixels.
```

### If the generator will not hold the body still

The failure mode to expect is a body that drifts, breathes or subtly redesigns
itself from cell to cell. Fixes, in order of what to try:

1. Re-roll. This is mostly a sampling lottery.
2. Feed the **accepted still** back in as a reference image and ask for the sheet
   again ("four copies of this exact mech in a 2x2 grid, identical body, only the
   legs re-posed").
3. Fall back to four separate image-to-image edits of the accepted still ("keep
   everything identical, move only the legs into <pose>"), then compose the four
   results into one 1024² grid by hand. Cross-image consistency is weaker than
   within one image, so this is the last resort, not the default.

---

### Tip for consistency across the set

Generate the whole set in one session and, if the tool supports it, reference the
first accepted image ("same art style, lighting, line weight and top-down framing
as this, but a <chassis> for the <faction>"). Keep line weight and palette
identical within a faction so a mixed army looks like one cohesive force.

Do the `legs` sheet **last** in each faction's run: it is the hardest generation
here, and by then there are two accepted siblings to anchor its style against.
