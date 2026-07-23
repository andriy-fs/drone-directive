# Observer drone sprite prompt

The player's flying **observer drone** — the mobile "eye" the camera follows.
There is only **one faction** for it (player-owned), so a single sprite. The
prompt bakes in the [Shared spec](README.md#shared-spec-applies-to-every-prompt--do-not-vary);
re-sync the intro line if the shared rules change. Copy the fenced block straight
into Gemini / ChatGPT.

Reminder baked into the prompt: **top-down, facing straight up, transparent
background, 512×512, centered, one unit.** Unlike the robots, the drone carries
**no weapon**, so it needs **no central hardpoint** — the dorsal center is a
camera gimbal, not an empty mount. It should read as **airborne and light**, not
a ground vehicle: visible rotor arms/props and a small cast-forward silhouette.

---

## Observer drone — `drone-player.png`

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

## Wiring the generated art into the game

1. Export as a transparent PNG and drop it in `public/` as `drone-player.png`.
2. Register it in `src/config/sprites.ts` (add a `droneSprite` export, mirroring
   `obstacleSprite` / `groundSprite`), authored facing up →
   `rotationOffset: Math.PI / 2`, on-field diameter ~40 px (a touch smaller than a
   robot's 46 px — it's a light recon flyer):
   ```ts
   export const droneSprite: SpriteDef | undefined = {
     src: '/drone-player.png',
     rotationOffset: Math.PI / 2,
     targetSize: 40,
   };
   ```
   Add its `src` to `spriteSources()` so it preloads, add a `getDroneTexture()` to
   `src/pixi/assets.ts` (mirror `getRobotTexture`), and have
   `src/pixi/render/DroneView.ts` draw the `Sprite` when the texture resolves,
   falling back to the current Graphics diamond otherwise.
3. Keep the drone on the `overlay` layer with `container.eventMode = 'none'` so the
   art (and its sight-zone ring) never intercepts pointer clicks.

## Per-image checklist before accepting a generation

- [ ] Transparent background (no white box, no shadow, no ground).
- [ ] Pointing straight up, perfectly top-down (no perspective tilt).
- [ ] Centered with padding; rotor discs not touching the frame edge.
- [ ] Reads clearly at ~40 px; strong silhouette, obviously a flyer.
- [ ] Central camera/eye is the focal point; allied blue/teal palette.
