# Asset loading and the first paint

Plan for getting the title screen off ~6 MB of assets it does not need yet.
Written before implementation; the decisions at the bottom of each step are the
agreed ones, not options.

## Problem

The title screen is a DOM menu over one piece of key art. It downloads ~6 MB.
Measured against `client/dist`:

| Asset                                          | Size                  | When it is fetched                                                             |
| ---------------------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `index-*.js` (React + Pixi + engine + net + chat) | 668 KB / 197 KB gzip | immediately                                                                    |
| `menu-backdrop.webp`                           | 1.1 MB                | **after** the bundle executes — the URL is injected from JS (`MainMenu.tsx:68`) |
| `ground-tile.png` (1024²)                      | 1.6 MB                | `GameApp.init`, though nothing draws it until a match exists                    |
| 18 robot / base / weapon PNGs                   | ~2.4 MB               | `GameApp.init`, behind a blocking `await`                                       |
| 14 ogg cues                                     | 196 KB                | `GameApp.init`                                                                 |

Three separate causes:

1. The LCP image starts late (it waits for the bundle to run) and is roughly four
   times larger than it needs to be under a `blur(3px)`.
2. `await loadGameAssets()` in `GameApp.init` (`client/src/pixi/GameApp.ts:104`)
   pulls the **entire** sprite atlas before the first frame of a screen that
   draws none of it.
3. Sprite sources are 226–500 px where the game draws them at 24–96 px.

Target: ~6 MB → ~0.7 MB on the title screen, with no visible change to the game.

Two things are deliberately **out of scope** and listed at the end.

## Step 1 — `menu-backdrop.webp`: shrink it and start it earlier — **DONE**

**Re-encode.** The shipped file turned out to be **lossless** VP8L at 1672×941 —
that, not the resolution, is where the 1.1 MB came from. 1672 px is already under
the 1920 cap, so no resize: only lossy re-encoding.

The `blur(3px)` in `App.css:522` sits on `.menu`, the panel — **not** on the art,
which renders sharp under `background-size: cover`. So quality budget matters more
than first assumed, and since even q90 came in at 143 KB there was room to spend:

| quality      | size   | SSIM vs. master |
| ------------ | ------ | --------------- |
| q70          | 55 KB  | 0.968           |
| q80          | 77 KB  | 0.977           |
| q90          | 143 KB | 0.987           |
| **q93** ✅   | 205 KB | 0.990           |
| q95          | 238 KB | 0.992           |

Shipped **q93** (`cwebp -q 93 -m 6`) → **1,107,246 → 205,182 bytes (−81%)**. The
art is very dark with wide smooth gradients, i.e. the worst case for lossy
banding; at q90 a shadow-lifted crop of the sky still showed faint blocking, at
q93 it is clean. `-sharp_yuv` was tested and did not help (chroma SSIM got
slightly worse), so it is not used.

The lossless master moved to **`client/assets-src/menu-backdrop.webp`** — in the
repository, outside `public/`, so it never reaches a build. That directory is the
one Step 2 introduces for the sprite masters; it exists now because re-encoding
the backdrop would otherwise have destroyed the only copy.

**Preload** it from `client/index.html`, next to the existing `<link rel="icon">`:

```html
<link rel="preload" as="image" href="/menu-backdrop.webp" fetchpriority="high" />
```

The leading `/` is required, not a slip: the file lives in `public/`, and Vite
rewrites such a reference to `./menu-backdrop.webp` under `base: './'` — exactly
what it already does to `/favicon.svg` (confirmed in the built `dist/index.html`).
The request then leaves the HTML parser, in parallel with the bundle, instead of
waiting for it to execute.

**Verify the two URLs agree.** `menuBackdropSrc` (`client/src/config/sprites.ts:159`)
builds an absolute URL via `new URL(…, window.location.href)`. If the preload
resolves to a different string, the page downloads the backdrop twice — worse
than before. This is the single most important verification item in this document.

Checked against both servers. Under `vite preview` (production `base: './'`) the
tag is served as `href="./menu-backdrop.webp"` and that path returns 205,182 bytes
of `image/webp`; under `npm run dev` (`base: '/'`) it stays `/menu-backdrop.webp`.
Both resolve against the document URL to exactly what `new URL(…)` produces, and
neither request carries `crossorigin`, so the CSS `background-image` reuses the
preload rather than issuing a second fetch.

One pre-existing caveat, unchanged by this step: if the page is ever served
without a trailing slash (`…/drone-directive`), both the preload and
`menuBackdropSrc` resolve one directory too high — together, so still one fetch,
just a 404. GitHub Pages redirects to the trailing-slash form, so it does not bite.

## Step 2 — re-encode the sprites to WebP, downscaled — **DONE**

The views scale the image themselves —
`img.scale.set(target / max(texture.width, texture.height))`
(`client/src/pixi/render/RobotView.ts:64-68`) — and `Grid.ts:27` derives
`tileScale` from `sprite.texture.width`. **Shrinking the sources therefore needs
no code change** beyond the `src` strings. The camera has no zoom
(`zoom = 1`, `client/src/pixi/Camera.ts:18`), so the ceiling is
`targetSize × devicePixelRatio`.

| Files                                        | Now         | Target       | On-field | Why that size            |
| -------------------------------------------- | ----------- | ------------ | -------- | ------------------------ |
| `robot-{tracks,wheels,legs}-{player,ai}`     | 226–500² PNG | **128²** WebP | 46 px    | DPR 3 → 138              |
| `base-{player,ai}`                           | 256² PNG     | **256²** WebP | 96 px    | DPR 3 → 288; keep as is  |
| `weapon-{bomb,dew,radar}-{player,ai}`        | 256–500² PNG | **64²** WebP  | 24 px    | DPR 3 → 72               |
| `drone-player`                               | 256² PNG     | **128²** WebP | 40 px    | DPR 3 → 120              |
| `obstacle-{crater,mountain}`                 | 64² PNG      | **64²** WebP  | 32 px tile | already minimal        |
| `ground-tile`                                | 1024² PNG    | **512²** WebP | 128 px repeat | least detail-critical |

Actual: **4,080 KB → 163 KB (−96%)**, better than the ~250–300 KB estimate. Sizes
went out at quality 90 (82 for the ground tile); the per-file table is printed by
the script.

**Encoding.** Built as `client/scripts/encode-sprites.mjs` — a one-shot script with
the source → size → quality table, run by hand and its output committed. **Not**
wired into `npm run build`. ffmpeg scales, `cwebp` encodes (that is where
`-alpha_q` and the effort knob live). Two things in it are about correctness, not
size, and both were measured rather than assumed:

- **Premultiply before scaling.** Transparent pixels in the masters are
  RGBA(0,0,0,0) — *black*. Scaling non-premultiplied RGBA averages that black into
  the edge pixels, and Pixi (which uploads premultiplied) darkens them again, so
  the sprite gets a dark fringe. Naive vs. premultiplied downscale of one robot
  differ at SSIM 0.90, all of it on the cutout edge. Chain:
  `format=rgba,premultiply=inplace=1,scale=…:flags=lanczos,unpremultiply=inplace=1`.
- **Wrap-pad the seamless tiles** (ground, both obstacles): laid out `tile=3x3`,
  scaled, middle cropped back out, so the resampler reads the neighbouring tile
  instead of clamping at the edge. Verified by rendering the encoded ground 2×2 —
  no seam.

Quality was picked by compositing each candidate over the panel colour and taking
SSIM against the scaled master (measuring the raw RGBA is meaningless — `cwebp`
zeroes the RGB under transparent pixels, which SSIM counts as error). At 128²:
q80 → 0.989, **q90 → 0.995**, q95 → 0.997, and the whole set fits in 163 KB either
way, so q90.

**Keep the masters.** Done: the 18 PNGs moved to `client/assets-src/sprites/` — in
the repository, outside `public/`, so they never reach a build. `public/` now holds
no PNGs at all, and nothing in it is hand-editable. The script errors out if a
master has no entry in its table, so a forgotten one cannot silently never ship.

`.docs/sprites/README.md` gained a "Where the files live" section, and the
per-asset prompt docs now point their export step at `assets-src/` and the encoder.
Two stale claims were corrected while in there: the obstacle docs said the shipped
tiles were 1024² needing re-export (they were already 64²), and the README said
per-faction art still needed a code change (it has been keyed on `owner` for a
while).

`src` strings in `client/src/config/sprites.ts` flipped `.png` → `.webp` across
`robotSprites`, `baseSprites`, `weaponSprites`, `terrainSprites`, `groundSprite`
and `droneSprite`.

## Step 3 — take the sprite load off the critical path

**The invariant that must not break:** `cached()`
(`client/src/pixi/assets.ts:96-102`) memoizes a **miss as `null` forever**. If the
world is built before the textures arrive, those units keep their Graphics
placeholders until the page is reloaded. So "let it pop in when it lands" is not
an option here — the match start needs an explicit gate.

**In `GameApp.init`** (`client/src/pixi/GameApp.ts:104`), replace
`await loadGameAssets()` with a background warm-up:

```ts
warmGameAssets(); // Assets.backgroundLoad(spriteSources()) — one file at a time, does not starve the backdrop
```

`Assets.backgroundLoad` is present in the installed pixi.js 8.19.0
(`Assets.d.ts:611`) and loads at low priority; a later `Assets.load` of the same
URL promotes it and reuses the same promise. That pairing is the API's intended
use.

**In `assets.ts`**, memoize `loadGameAssets()` exactly the way the sound loader
already does (`soundLoad ??= registerSounds()`, `client/src/pixi/assets.ts:45-49`),
and add `warmGameAssets()` alongside it.

**Gate the match start** — there are two entry points:

- **Offline** (`client/src/pixi/GameApp.ts:352`, inside the synchronous `step()`):
  do not consume `restartRequested` until the assets are ready — hold the flag
  pending and keep the ticker awake. This is the same manoeuvre already documented
  in `.docs/tasks/menu-start-restart-idle-loop.md`; reuse that guard in `render()`
  rather than inventing a second one.
- **Online** (`client/src/pixi/GameApp.ts:592`): that path is already async (a
  socket callback), so a plain `await loadGameAssets()` before `engine.startMatch`
  is enough.

In practice ~300 KB has landed long before anyone clicks Start; the gate is
insurance against a permanent placeholder on a slow link, not the expected path.

## Step 4 — two tiers of sound

All 14 cues load from `GameApp.init` today (`client/src/pixi/GameApp.ts:93`). The
AudioContext starts suspended and is only resumed from the Start button
(`sfx.resume`), so no cue can physically sound before the first gesture — yet the
14 requests already compete with the backdrop.

Split `soundSources()` (`client/src/config/sounds.ts:68`) into two tiers by adding
a tier tag to `SoundDef`, so the table stays the single source of truth:

- **menu** (~44 KB): `button-click`, `modal-open`, `chat-message`, `chat-send`.
  Chat belongs here on purpose: `<ChatPanel/>` renders unconditionally
  (`client/src/ui/App.tsx:167`) and `restoreChat` pulls history on mount, so
  `sfx.chatMessage()` can fire while the menu is still up.
- **match** (~152 KB): everything else — shots, the explosion, `select-*`,
  `unit-ready`.

The menu tier loads from a `requestIdleCallback` (falling back to
`setTimeout(…, 0)`) after the first frame, instead of from `init`. The match tier
rides the same gate as the sprites (Step 3). Make the `soundLoad ??=` memo
per-tier. `markSoundReady` and the `ready` set are already per-cue, so the tiering
needs no change inside `client/src/pixi/audio/sfx.ts`.

The cost: the very first `button-click` may be silent if the player clicks before
the idle callback runs. Accepted.

## Step 5 — reconcile the docs

- `CLAUDE.md` says the samples live in `client/public/sfx/`; on disk they are in
  `client/public/sounds/`. Fix the doc.
- `.docs/sprites/README.md` — add the masters-in-`assets-src/` + WebP export note
  from Step 2.
- The header comment in `client/src/config/sounds.ts` describes one undifferentiated
  load; update it for the tiers.

## Verification

The mandatory gate from `CLAUDE.md` (`type-check` is not needed — none of
`server/`, `protocol/`, `net/`, `chat/`, `types/` are touched):

```sh
npm run build && npm test && npm run lint
```

By eye, under `npm run dev`:

1. The menu renders and the backdrop still looks right after re-encoding.
2. In a match: robots, bases, weapon modules, obstacles and ground all show
   sprites, not Graphics placeholders. Check all three chassis × both sides, and
   both obstacle kinds.
3. Sound: a menu button, a modal opening, all three shot types, an explosion,
   `unit-ready`, a group selection, a chat message.
4. Match → menu → new match: ground and fog rebuild (`rebuildGround` /
   `rebuildFog`) and no placeholders appear.
5. Online (`npm run dev:relay`): the match starts and the sprites are there from
   the first frame.

In DevTools Network, throttled to Slow 4G, hard-reloading `npm run preview` (which
serves under `base: './'`, as production does):

6. `menu-backdrop.webp` is fetched **once**, not twice, and starts alongside the
   bundle rather than after it.
7. The menu issues no blocking requests for `ground-tile`, the sprites, or the
   match sound tier — only background ones.
8. Total transfer to an interactive menu is ≈ 0.7 MB.

Optional: the `web-perf` skill (Chrome DevTools MCP) for a before/after LCP number.

## Out of scope

- **Pruning `public/sounds/`** — 235 files / 7.6 MB ship in `dist` while 14 are
  used. It costs deploy size and CI time, not page load. Decided: leave it.
- **Lazy `import()` of `GameApp`** inside `useGameApp` (−~120 KB gzip off the first
  screen). Touches the Pixi bridge's lifecycle; separate task.
- **Cache headers / service worker** — files in `public/` are served without a hash
  in the name, so `immutable` cannot be applied to them. That is the separate
  conversation about caching static assets.
