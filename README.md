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
- **Online 2-player** — host or join a room by a 4-character code and play
  head-to-head over a WebSocket relay. The match runs in **deterministic
  lockstep**: only each player's per-tick orders cross the network, and both
  clients simulate the identical world from one shared seed. Each side pilots its
  own observer drone, has its own fog of war, and sees itself in the friendly
  colour. Design: [.docs/multiplayer.md](.docs/multiplayer.md) · backend:
  [.docs/server-relay.md](.docs/server-relay.md).

## Getting started

Requires a recent Node.js (Vite 8 needs Node 20.19+ or 22.12+).

This is an **npm-workspaces monorepo** — the game lives in the `client`
workspace, the online relay in `server`, and the wire types they share in
`protocol`. Run everything from the repo root: `npm install` installs all
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

The relay Worker has its own scripts (it is **not** covered by the root
`build`/`test`/`lint`):

| Command                        | Description                                           |
| ------------------------------ | ----------------------------------------------------- |
| `npm run dev -w server`        | Run the relay locally (wrangler/miniflare, no login). |
| `npm run type-check -w server` | Type-check the Worker (`tsc --noEmit`).               |
| `npm run deploy -w server`     | Deploy to Cloudflare (needs `npx wrangler login`).    |

### Online multiplayer (dev)

Solo vs. the bot by default; **Online (2P)** in the menu plays head-to-head. Run
the relay Worker locally and point the client at it:

```bash
npm run dev -w server   # relay on ws://localhost:8787 (wrangler dev, no login)
npm run dev             # client; VITE_MULTIPLAYER_URL defaults to that relay
```

Open two tabs, host in one, join with the code in the other. Both tabs simulate
the same match — the host plays one side, the guest the other.

For a deployed build, set `VITE_MULTIPLAYER_URL=wss://<your-worker-host>` at build
time; the relay deploys separately (`npm run deploy -w server`). How the backend
works is documented in [.docs/server-relay.md](.docs/server-relay.md), the CI setup
for both halves in [.docs/deployment.md](.docs/deployment.md).

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

The repo is an **npm-workspaces monorepo** with three workspaces:

- **`client/`** — the game itself (everything below).
- **`server/`** — the online-multiplayer relay: a Cloudflare Worker whose
  `Room` Durable Object pairs two player sockets, mints the shared RNG seed, and
  forwards lockstep tick messages. It runs no game logic and stores nothing —
  see [`.docs/server-relay.md`](.docs/server-relay.md).
- **`protocol/`** — the types-only wire protocol the other two share, so neither
  imports the other's source.

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
      net/      #   LockstepSession (WebSocket transport) + relay URL config
    ui/         # React: App, GameCanvas, hud/, screens/, common/, hooks/
    store/      # gameStore (Zustand) + selectors (shared with the Pixi bridge)
    config/     # gameConfig, palette, sprites
    types/      # enums, entities (value types), tasks, commands
    i18n/       # locale dictionaries (en/ru/uk/pl)
  public/       # static assets + placeholder sprites
protocol/         # @drone-directive/protocol — shared wire types (no runtime deps)
server/           # @drone-directive/server — relay Worker: index.ts (router) + Room.ts (Durable Object)
```

### Documentation

| Doc                                              | Covers                                                        |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [`.docs/engine-ecs.md`](.docs/engine-ecs.md)     | The ECS model (miniplex) and the fixed-step system pipeline.  |
| [`.docs/movement.md`](.docs/movement.md)         | Pathfinding (A\*) and movement.                               |
| [`.docs/zustand.md`](.docs/zustand.md)           | Store rationale, snapshots, and the UI↔engine seam.           |
| [`.docs/multiplayer.md`](.docs/multiplayer.md)   | Online design: why lockstep, the tick loop, determinism.      |
| [`.docs/server-relay.md`](.docs/server-relay.md) | How the relay Worker + `Room` Durable Object are implemented. |
| [`.docs/deployment.md`](.docs/deployment.md)     | Deploying the UI (Pages) and the relay (Cloudflare) from CI.  |

### Sprites

Robot art is registered in `client/src/config/sprites.ts` (chassis → image, with an
optional crop frame). Missing entries fall back to a coloured shape, so art
can be added incrementally — drop a transparent, top-down PNG into `client/public/`
and add one registry entry.

## Credits

An independent, educational RTS built as a personal project.

## License

Drone Directive — a browser-based top-down real-time strategy game.
Copyright (C) 2026 andriy-fs

This program is free software: you can redistribute it and/or modify it under
the terms of the **GNU General Public License** as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this
program. If not, see <https://www.gnu.org/licenses/>.

The full text is in [LICENSE](LICENSE) (SPDX: `GPL-3.0-or-later`). In short: forks
and derivative works must also be released under the GPL, with source available.
