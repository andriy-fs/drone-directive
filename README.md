# Drone Directive (Web)

A browser-based top-down real-time strategy game where you build, arm, and
program drones to destroy the enemy base before it destroys yours.

Built with **React 19 · PixiJS 8 · TypeScript · Vite · Zustand**.

> Placeholder art is used throughout; the rendering layer already supports
> swapping in real PNG sprites (see [Sprites](#sprites)).

## Features

- **Top-down battlefield** on a tile grid, with a pannable camera.
- **Bases** with production queues, health, and win/lose on destruction.
- **Robots** — 3 chassis (tracks / wheels / legs) × 3 weapon options
  (none / cannon / missiles), each with distinct speed, HP, range, and damage.
- **Selection & group control** — click, shift-click, drag-marquee, and
  `Ctrl+A`; move whole groups in formation.
- **Programming** — assign tasks (Guard, Attack Base, Attack Robots) to one or
  many units; robots execute them autonomously.
- **Combat** — projectiles with cooldowns, line-of-sight, damage, and
  explosions.
- **Resource economy** — both sides earn resources over time and spend them on
  production.
- **Enemy AI** — escalating, resource-gated production with a staged strategy
  (defend → attack bases → intercept threats).
- **Random obstacles** — each match generates terrain that blocks movement and
  shots; units **pathfind around** it (A\*), and a route is always guaranteed.
- **Difficulty levels** — Easy / Normal / Hard change the starting unit counts.
- **Base setup from the menu** — pre-configure continuous auto-production and the
  initial task given to every new robot.
- **Pause**, **sound effects** (synthesized, no assets), and a full
  **menu → match → victory/defeat → replay** loop.

## Getting started

Requires a recent Node.js (Vite 8 needs Node 20.19+ or 22.12+).

```bash
npm install
npm run dev      # start the dev server (prints a local URL)
```

### Scripts

| Command           | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `npm run dev`     | Start the Vite dev server with HMR.                           |
| `npm run build`   | Type-check and build for production (`tsc -b && vite build`). |
| `npm run preview` | Serve the production build locally.                           |
| `npm run lint`    | Run ESLint.                                                   |

## Controls

| Input                            | Action                                          |
| -------------------------------- | ----------------------------------------------- |
| **Left-drag** (empty ground)     | Box-select your robots (marquee)                |
| **Left-click** a robot           | Select it                                       |
| **Shift+click** / **Shift+drag** | Add to the current selection                    |
| **Ctrl/Cmd + A**                 | Select all your robots                          |
| **Left-click** empty ground      | Clear selection                                 |
| **Right-click**                  | Move the selection to that point (in formation) |
| **Middle-mouse drag**            | Pan the camera                                  |
| **Esc** / **Space** / **P**      | Pause / resume                                  |

Use the **Program** panel in the HUD to assign a task to the selected unit(s),
and the **Build Robot** dialog to produce units (once or on a continuous
auto-build loop).

## How a match flows

1. On the **main menu**, pick a difficulty and optionally configure the base
   (auto-produce a chosen robot type, and/or a default program for new robots).
2. Earn resources over time; **build** and **program** robots.
3. Send units to **attack the enemy base** while defending your own.
4. Destroy all enemy bases to win (or lose if yours fall). Then **Play Again**
   or return to the menu.

## Architecture

Three layers with strict boundaries, plus a **Scene-based ECS** game core:

- **Engine** (`src/engine`) — pure game core: **ECS (miniplex)** entities +
  systems (movement/pathfinding, combat, tasks, AI, economy, production…),
  Menu/Game **scenes**, a `GameEngine` facade, and a typed **EventBus**. No
  React, Pixi, or store imports.
- **Pixi** (`src/pixi`) — canvas rendering and input (fixed-step loop,
  reactive-query renderer, entity views, camera, sprites) + the engine↔store
  bridge.
- **React/UI** (`src/ui`, backed by `src/store`) — the HUD, screens, and
  overlays, using a Zustand store.

Data flows one way in each direction: **UI → command queue / flags → GameEngine
(scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. The
EventBus is a supplement (discrete events); the store stays the render-state
channel. The only React↔Pixi seam is `GameCanvas` + `useGameApp`.

```
src/
  engine/     # game core (no React/Pixi/store)
    ecs/      #   entity (components), world, factory
    systems/  #   commands, economy, ai, production, task, movement, combat, reap, explosion
    game/     #   engine (facade), scene + scenes/, eventBus, events, context
    (helpers) #   pathfinding, obstacles, economy, tasks/
  pixi/       # GameApp (bridge), GameLoop, Camera, layers, assets, input/, render/
  ui/         # React: App, GameCanvas, hud/, screens/, common/, hooks/
  store/      # gameStore (Zustand) + selectors (shared with the Pixi bridge)
  config/     # gameConfig, palette, sprites
  types/      # enums, entities (value types), tasks, commands
```

### Sprites

Robot art is registered in `src/config/sprites.ts` (chassis → image, with an
optional crop frame). Missing entries fall back to a coloured shape, so you can
add art incrementally — drop a transparent, top-down PNG into `public/` and add
one registry entry.

## Working in this repo

- **Verify before finishing:** `npx tsc -b`, `npx eslint .`, and `npm run build`
  must all be clean; boot the dev server to sanity-check gameplay.
- **`CLAUDE.md`** documents conventions and points to per-layer skills in
  `.claude/skills/` (engine / pixi / react).
- TypeScript is configured strictly (`erasableSyntaxOnly`,
  `verbatimModuleSyntax`): no TS `enum`s, no constructor parameter properties,
  and `import type` for type-only imports.

## Credits

This is an independent, educational RTS-inspired reimplementation.
