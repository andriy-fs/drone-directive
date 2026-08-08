# Prompt: redesign the HUD sidebar of "Drone Directive"

> Copy everything below the line and send it to the design agent together with a screenshot of the
> current sidebar. The returned design comes back here to be turned into an implementation plan.

---

## Your task

Design a **new HUD sidebar** for a browser real-time-strategy game. The current sidebar (see the
attached screenshot) works, but it is a stack of text lists: hard to scan mid-fight, repetitive, and
its footer is a wall of hotkey text. Redesign the layout, the controls and the information density.
Keep every capability listed below — you may merge, re-group, re-prioritise, iconify or move things
between "always visible" and "on demand", but nothing may become unreachable.

## The game in one paragraph

**Drone Directive** is a top-down RTS played in the browser (React + PixiJS, desktop, mouse +
keyboard, dark sci-fi look). The player owns one **base** that produces **robots**; a robot is a
*chassis* (Tracks / Wheels / Legs) plus a *weapon* (Cannon, Missiles, Bomb, Radar, EW, DEW). Instead
of micro-managing units the player **programs** them with a standing directive — Guard, Attack Base,
Attack Robots, Search & Detect, Overwatch — which the units then execute on their own. Resources
accumulate over time and are spent on production. The player also flies a single **observer drone**
(WASD) that can land on an idle robot and possess it. A match has 2–4 sides (one human + 1–3 AI, or
two humans online); you win when every enemy base is destroyed. The sidebar is the whole HUD: it
sits to the left of the map viewport and is the only place the player reads state and issues
non-mouse orders.

## Hard constraints

- **Dark theme, one theme only.** Current tokens: page `#0d1117`, panel `#12161f`, borders
  `#232a36`, body text `#b6c0cf`, headings `#eef2f7`, dim text `#6b7686`. Numeric values are set in
  a monospace face, everything else in a UI sans. You may extend the palette (an accent colour is
  welcome — there is none today) but stay in this dark, low-chroma register.
- **Side colours are fixed** and must stay identical to the ones drawn on the map: local player
  `#3b82f6`, opponents in seating order `#ef4444`, `#f59e0b`, `#a855f7`, neutral `#9ca3af`.
- **Width** is currently a fixed `260px` column, full viewport height, vertically scrollable. You may
  propose a different fixed width (roughly 240–320px is realistic) but not a fluid or collapsible
  one, and not a horizontal/bottom bar.
- **It must fit 4 sides** in every per-side list, and it must remain usable at ~700px viewport
  height without scrolling away anything critical.
- **It is localised** (English, Russian, Ukrainian, Polish) — assume any label can be ~1.6× longer
  than the English one and must not be truncated into meaninglessness. Don't rely on text fitting
  exactly.
- **Implementable in plain CSS + React**, no canvas/WebGL inside the panel, no per-frame animation.
  Icons come from **lucide** (any lucide icon is available). Small SVG shapes are fine.
- Desktop mouse only — hover tooltips are acceptable for *secondary* detail, never for primary state.
- The panel is only rendered **during a match**; the title screen and menus are a separate design and
  are out of scope.

## What the sidebar contains today (top to bottom)

Everything here is live data unless marked. This is the inventory you must cover.

1. **Titlebar** — game title "Drone Directive" + two icon buttons: pause/resume (icon reflects the
   simulation, disabled when the online link is down) and sound settings (icon reflects muted state,
   opens a dialog).
2. **Status line** — `Status: playing · Normal`. Status is one of *menu / playing / won / lost*;
   the second token is match difficulty (*Easy / Normal / Hard*).
3. **"Command" section**
   - **Resources** — one row per side, local side first: colour dot + label (`Resources` for the
     local player, `AI 1` / `AI 2` / `Opponent` for the others) + an integer amount.
   - **Production** — a caption (`Building · 3 queued`, or `Nothing in queue`) above a horizontal
     progress bar showing the current build.
   - **Observer drone** — a caption (`Observer drone`) above a bar showing the drone's hull; when the
     drone is destroyed the caption becomes `Drone lost · rebuilding` and the bar shows respawn
     progress instead.
   - **Auto-build row** *(only when auto-production is on)* — `Auto: Tracks/Cannon · Guard` plus a
     small **Stop** button.
   - **"Build & Program" button** — the primary action; opens a modal where the player picks chassis,
     weapon and starting directive, sees the cost and available resources, and either builds once or
     sets auto-build. (The modal itself is out of scope — only its entry point lives here.)
4. **"Bases" section** — one row per base on the map: colour dot + side label + (when that base is
   producing) a gear icon with the queue length + `hp/maxHp`.
5. **"Units" section** — one row per side: colour dot + side label + number of living robots. An
   eliminated side keeps its row, dimmed to 45%.
6. **"Directive" section** — the selection readout, in one of four mutually exclusive states:
   - *nothing selected*: the muted line "Select unit(s) to program."
   - *only enemy units selected*: "Enemy unit — cannot program."
   - *own robots selected*: a header (one robot → its chassis name; several → "5 robots selected"),
     then a row of **five directive buttons** (Guard, Attack Base, Attack Robots, Search & Detect,
     Overwatch) where the one the whole selection already runs is highlighted — some are hidden when
     no selected unit can perform them. For a single robot it also shows *Weapon*, *Health*
     `34 / 60`, and a health bar.
   - *own base selected*: header "Base", then *New units* (the directive its production gets),
     *Rally point* (`120, 88` or "Not set"), and a one-sentence hint that the rally point is set by
     right-clicking the map.
7. **"Drone" section** *(while playing)* — one line: "Piloting a robot" or "Observing".
8. **Footer hint** — a single long paragraph listing every control: box-select by dragging, click to
   select, Shift to add, Ctrl+A for all, right-click to move, WASD/arrows to fly the drone, F to
   land/take off, E to fire/detonate, Esc/Space to pause.

Two things live *outside* the sidebar and stay there: a floating chat panel (online matches) and a
full-viewport "Paused" / "Waiting for the opponent" overlay on the map.

## What is wrong with it — the problems to solve

Treat these as the brief, not as a list of patches:

- **Per-side data is scattered across three separate lists** (resources, bases, units), each
  repeating the same dot + side label. A player asking "how am I doing versus AI 1?" reads three
  places.
- **Own state and enemy state are not visually separated.** The player's own resources, production
  and units deserve a different weight than the intelligence about opponents.
- **The "Directive" section changes height dramatically** between its four states, so everything
  below it jumps while the player clicks around the map.
- **Almost everything is text.** There are no icons for chassis, weapons or directives, and nothing
  is scannable in peripheral vision during a fight.
- **The primary action ("Build & Program") sits below two progress bars**, in the middle of the
  panel, styled like everything else.
- **The footer hint is unreadable** as a paragraph and takes permanent space for information the
  player needs mostly in the first two minutes.
- **Unit counts are a single number** — the player cannot see the composition of their own force
  (how many of each weapon), which is the thing they actually plan against.
- Long localised labels crowd the 260px column, especially in the resource and base rows.

## What to deliver

1. **A mockup of the redesigned sidebar** at realistic scale (panel plus a hint of the dark map to
   its right), rendered in the palette above.
2. **The variable states drawn out**, at least: nothing selected · one own robot selected · several
   robots selected · own base selected · auto-build active · a side eliminated. A compact set of
   panels side by side is fine.
3. **Annotations** naming each block and saying which of the items in the inventory above it covers,
   so nothing gets lost in translation.
4. **Specs**: panel width, section spacing, font sizes and weights, any new colours as hex, icon
   sizes, and which lucide icon you intend for each spot.
5. **A short note on anything you moved behind a hover, a tab, a collapsed section or a dialog**, and
   why it is safe there.
6. **A flag on anything that needs data the panel doesn't have today** (e.g. a breakdown of the
   player's units by weapon, income per second, a match timer) — list it explicitly so it can be
   costed.
