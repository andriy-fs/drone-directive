# Drone Directive

**[▶ Play now](https://andriy-fs.github.io/drone-directive/)**

A browser-based top-down real-time strategy game where you build, arm, and
program robots to destroy the enemy base before it destroys yours.

Built with **React 19 · PixiJS 8 · TypeScript · Vite · Zustand**.

> Placeholder art is used throughout; the rendering layer already supports
> swapping in real PNG sprites (see [Sprites](#sprites)).

## Features

- **Top-down battlefield** on a tile grid, with a pannable/zoomable camera and
  three map-size presets (40×40 / 60×60 / 80×80).
- **Bases** with production queues, health, and win/lose on destruction.
- **Robots** — 3 chassis (tracks / wheels / legs) × 5 weapons: cannon and
  missiles for direct combat, a kamikaze bomb, a radar module that doubles its
  own sight radius, and an EW jammer that halves nearby enemies' sight.
- **The observer drone** — a free-flying "eye" you pilot directly that reveals
  the map and can land on an idle robot to fire its weapon manually.
- **Selection & group control** — click, shift-click, drag-marquee, `Ctrl+A`,
  double-click to select every robot sharing a weapon, and classic RTS control
  groups (`Ctrl+1-9` to save a selection, `1-9` to recall it).
- **Programming** — assign directives (Idle, Guard, Attack Base, Attack
  Robots, Scout, Attack Target) to one or many units; robots execute them
  autonomously.
- **Combat** — projectiles with cooldowns, line-of-sight, distinct visuals and
  sound per weapon, and area-of-effect explosions.
- **Resource economy** — both sides earn resources over time and spend them on
  production.
- **Enemy AI** — resource-gated production with staged wave attacks, a
  reactive defense that pulls guards (and, against a large enough assault, its
  whole army) back home, a kamikaze that picks between rushing the base or a
  cluster of your robots, a guaranteed EW jammer, and a posture system that
  presses an advantage or turtles up based on the current robot-count balance.
- **Random obstacles** — each match generates terrain that blocks movement and
  shots; units **pathfind around** it (A\*), and a route is always guaranteed.
- **Difficulty levels** — Easy / Normal / Hard change the starting unit counts.
- **Base setup from the menu** — pre-configure continuous auto-production and
  the initial directive given to every new robot.
- **4 languages** — English, Russian, Ukrainian, Polish.
- **Pause**, **sound effects** (synthesized, no assets), and a full
  **menu → match → victory/defeat → replay** loop.

## Getting started

Requires a recent Node.js (Vite 8 needs Node 20.19+ or 22.12+).

This is an **npm-workspaces monorepo** — the game lives in the `client`
workspace and a placeholder `server` workspace is reserved for future online
multiplayer. Run everything from the repo root: `npm install` installs all
workspaces, and the root scripts delegate to `client`.

```bash
npm install
npm run dev      # start the dev server (prints a local URL)
```

### Scripts

All run from the repo root and delegate to the `client` workspace.

| Command              | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `npm run dev`        | Start the Vite dev server with HMR.                           |
| `npm run build`      | Type-check and build for production (`tsc -b && vite build`). |
| `npm run preview`    | Serve the production build locally.                           |
| `npm run lint`       | Run ESLint.                                                   |
| `npm test`           | Run the Vitest engine test suite.                             |
| `npm run test:watch` | Run the test suite in watch mode.                             |

## Controls

| Input                            | Action                                          |
| -------------------------------- | ----------------------------------------------- |
| **Left-drag** (empty ground)     | Box-select your robots (marquee)                |
| **Left-click** a robot           | Select it                                       |
| **Shift+click** / **Shift+drag** | Add to the current selection                    |
| **Double-click** a robot         | Select all your robots carrying the same weapon |
| **Ctrl/Cmd + A**                 | Select all your robots                          |
| **Ctrl/Cmd + 1-9**               | Save the current selection as control group N   |
| **1-9**                          | Recall control group N                          |
| **Left-click** empty ground      | Clear selection                                 |
| **Right-click**                  | Move the selection to that point (in formation) |
| **Middle-mouse drag**            | Pan the camera                                  |
| **Esc** / **Space** / **P**      | Pause / resume                                  |
| **W A S D**                      | Fly the observer drone                          |
| **F**                            | Land the drone on / release an idle robot       |
| **E**                            | Fire the possessed robot's weapon               |

Use the **Program** panel in the HUD to assign a directive to the selected
unit(s), and the **Build Robot** dialog to produce units (once or on a
continuous auto-build loop).

## How a match flows

1. On the **main menu**, pick a language, difficulty, and map size, and
   optionally configure the base (auto-produce a chosen robot, and/or a
   default directive for new robots).
2. Earn resources over time; **build** and **program** robots, or fly the
   observer drone yourself.
3. Send units to **attack the enemy base** while defending your own — the
   enemy AI adapts to how the fight is going.
4. Destroy the enemy base to win (or lose if yours falls). Then **Play Again**
   or return to the menu.

## Architecture

The repo is an **npm-workspaces monorepo**: the game is the `client` workspace;
a `server` workspace is reserved for planned online multiplayer over WebSocket
(see [`.docs/multiplayer.md`](.docs/multiplayer.md)) and is not yet implemented.

Within `client/`, the game is three layers with strict boundaries, plus a
**Scene-based ECS** game core:

- **Engine** (`client/src/engine`) — pure game core: **ECS (miniplex)** entities +
  systems (movement/pathfinding, combat, tasks, AI, economy, production…),
  Menu/Game **scenes**, a `GameEngine` facade, and a typed **EventBus**. No
  React, Pixi, or store imports.
- **Pixi** (`client/src/pixi`) — canvas rendering and input (fixed-step loop,
  reactive-query renderer, entity views, camera, sprites) + the engine↔store
  bridge.
- **React/UI** (`client/src/ui`, backed by `client/src/store`) — the HUD, screens, and
  overlays, using a Zustand store.

Data flows one way in each direction: **UI → command queue / flags → GameEngine
(scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. The
EventBus is a supplement (discrete events); the store stays the render-state
channel. The only React↔Pixi seam is `GameCanvas` + `useGameApp`.

```
client/           # @drone-directive/client — the game (app code, configs, index.html)
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
    i18n/       # locale dictionaries (en/ru/uk/pl)
  public/       # static assets + placeholder sprites
server/           # @drone-directive/server — planned multiplayer backend (not yet implemented)
```

### Sprites

Robot art is registered in `client/src/config/sprites.ts` (chassis → image, with an
optional crop frame). Missing entries fall back to a coloured shape, so art
can be added incrementally — drop a transparent, top-down PNG into `client/public/`
and add one registry entry.

## Credits

This is an independent, educational RTS-inspired reimplementation.
