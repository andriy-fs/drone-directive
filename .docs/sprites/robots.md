# Robot sprite prompts

One prompt per **chassis × faction**. Every prompt already bakes in the
[Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary); if you
edit the shared rules, re-sync the intro line of each block. Copy a fenced block
straight into Gemini / ChatGPT.

Reminder baked into each prompt: **top-down, facing straight up, transparent
background, 512×512, centered, one unit, clear central weapon hardpoint.**

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

### Player (allied) — `robot-legs-player.png`

```text
Top-down (bird's-eye) game sprite of a tall armored walker mech on articulated
legs for a retro-futuristic RTS, viewed from directly above and pointing
straight up. A heavy central body with four or six articulated mechanical legs
splayed symmetrically around it, imposing and stable. Sleek allied faction
design: cool blue and teal armor plating with brushed-steel edges and cyan
accent lines, a glowing cyan optic and a hexagon chevron insignia on the top
carapace. A clear flat circular mount/hardpoint in the dead center of the top
carapace, left empty (a weapon will be attached there later). Bold readable
silhouette, semi-flat stylized art with light cel shading, soft top lighting
with subtle rim light. Fully transparent background, no ground, no shadow, no
text. Centered, filling about 80% of a 512x512 frame with even padding.
```

### Enemy (AI / hostile) — `robot-legs-ai.png`

```text
Top-down (bird's-eye) game sprite of a tall armored walker mech on articulated
legs for a retro-futuristic RTS, viewed from directly above and pointing
straight up. A menacing central body with four or six sharp articulated
mechanical legs splayed symmetrically around it, spider-like and threatening.
Hostile enemy faction design: aggressive angular gunmetal-and-dark armor with
red and orange plating, spiked carapace, rust streaks, scorch marks and
yellow-black hazard stripes, a single glaring red optic and a jagged emblem. A
clear flat circular mount/hardpoint in the dead center of the top carapace, left
empty (a weapon will be attached there later). Bold readable silhouette,
semi-flat stylized art with light cel shading, soft top lighting with subtle rim
light. Fully transparent background, no ground, no shadow, no text. Centered,
filling about 80% of a 512x512 frame with even padding.
```

---

### Tip for consistency across the set

Generate all six in one session and, if the tool supports it, reference the first
accepted image ("same art style, lighting, line weight and top-down framing as
this, but a <chassis> for the <faction>"). Keep line weight and palette identical
within a faction so a mixed army looks like one cohesive force.
