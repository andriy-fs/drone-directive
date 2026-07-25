# Drone Directive (web RTS)

Top-down RTS game built with **React 19 + PixiJS 8 + TypeScript + Vite + Zustand**.

## Monorepo (npm workspaces)

Three workspaces: **`client/`** (`@drone-directive/client` — the web game; all app code, configs, `index.html`, and `public/` live here, source under `client/src/**`, build output `client/dist/`), **`protocol/`** (`@drone-directive/protocol` — types-only wire protocol shared by the other two), and **`server/`** (`@drone-directive/server` — the online-multiplayer relay: a Cloudflare Worker + Durable Object; see `.docs/server-relay.md`). The root `package.json` only wires the workspaces; its `dev`/`build`/`lint`/`test` scripts delegate to `client` — the server has its own `dev`/`type-check`/`deploy` (`npm run <script> -w server`) and is **not** covered by the root build/test/lint.

## Commands

Run from the repo root (they delegate to the `client` workspace):

- `npm run dev` — Vite dev server.
- `npm test` — Vitest engine tests (must pass). `npm run test:watch` (inside `client/`) to iterate. Tests live next to the systems as `client/src/engine/systems/*.test.ts`.
- `npm run build` — production build (`tsc -b && vite build`, emits `client/dist`).
- `npm run lint` — ESLint.

Raw tools run from **inside `client/`**: `npx tsc -b` (type-check, must be clean), `npx eslint .` (lint, must be clean).

**Before considering any change done, run `npm run build`, `npm test`, and `npm run lint` (all clean).** For gameplay changes, also boot the dev server (on-screen behaviour can't be confirmed headless).

## Architecture (Scene-based + ECS core, three layers, strict boundaries)

- **Engine** (`client/src/engine/**`) — pure game core. **ECS via miniplex** (`ecs/` entities+components), **systems** (`systems/*` pure functions over the world), **scenes** (`game/scenes/*` Menu/Game with lifecycle), a `GameEngine` facade (`game/engine.ts`: `tick`/`startMatch`/`toMenu`/`setPaused`/`enqueueCommand`), and a typed **EventBus** (`game/eventBus.ts`) for discrete events. No React, no Pixi, **no store** imports.
- **Pixi** (`client/src/pixi/**`) — canvas rendering + input. Owns a `GameEngine`; `WorldRenderer` drives views from miniplex **reactive queries**; app-layer adapters subscribe the bus (audio) and push throttled snapshots to the store. No React imports.
- **React/UI** (`client/src/ui/**` — `App`, `GameCanvas`, `hud/`, `screens/`, `common/`, `hooks/`; plus `client/src/store/**`) — HUD/menus only. Talks to the Zustand store; never imports Pixi objects or ECS entities. (`client/src/store/**` stays outside `ui/` — the Pixi bridge reads it too.)

Data flow: **UI → command queue / control flags → GameEngine (scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. EventBus is a _supplement_ (discrete events: spawn/destroy/fire/gameOver/sceneChanged); the store stays the render-state channel. The single React↔Pixi seam is `GameCanvas` + `useGameApp`. Fixed-step 30 Hz loop + seeded RNG remain the deterministic backbone.

## Skills — load the matching one before editing a layer

Detailed, per-layer knowledge lives in `.claude/skills/` and auto-activates by task. Consult:

- **dd-engine** — `.claude/skills/dd-engine/SKILL.md` — ECS game core (`client/src/engine`): entities/components, systems, scenes, GameEngine, EventBus, pathfinding/obstacles/economy/tasks helpers.
- **dd-pixi** — `.claude/skills/dd-pixi/SKILL.md` — rendering/input (`client/src/pixi`): GameApp bridge, reactive-query `WorldRenderer`, entity views, camera, sprites/assets, pointer, bus/store adapters.
- **dd-react** — `.claude/skills/dd-react/SKILL.md` — HUD/state (`client/src/ui/**`, `client/src/store`): store snapshots/DTOs, command queue, control flags→engine, selectors, screens/hud/hotkeys.

## Project-wide conventions (tsconfig is strict)

- `erasableSyntaxOnly`: **no TS `enum`** (use the const-map + union pattern in `client/src/types/enums.ts`) and **no constructor parameter properties**.
- `verbatimModuleSyntax`: use `import type` for type-only imports.
- `noUnusedLocals`/`noUnusedParameters`: no dead symbols.

## Reference

- Engine internals: `.docs/engine-ecs.md` (ECS/miniplex), `.docs/movement.md` (pathfinding + movement), `.docs/zustand.md` (store rationale).
- Online multiplayer: `.docs/multiplayer.md` (lockstep design, tick loop, determinism), `.docs/server-relay.md` (the relay Worker + `Room` Durable Object), `.docs/deployment.md` (CI deploy of both halves).
