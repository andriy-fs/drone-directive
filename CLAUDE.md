# Drone Directive (web RTS)

Top-down RTS game built with **React 19 + PixiJS 8 + TypeScript + Vite + Zustand**.

## Commands

- `npm run dev` — Vite dev server.
- `npx tsc -b` — type-check (must be clean).
- `npx eslint .` — lint (must be clean).
- `npm test` — Vitest engine tests (`vitest run`, must pass). `npm run test:watch` to iterate. Tests live next to the systems as `src/engine/systems/*.test.ts`.
- `npm run build` — production build (`tsc -b && vite build`).

**Before considering any change done, run `tsc -b`, `eslint .`, `npm test`, and `build`.** For gameplay changes, also boot the dev server (on-screen behaviour can't be confirmed headless).

## Architecture (Scene-based + ECS core, three layers, strict boundaries)

- **Engine** (`src/engine/**`) — pure game core. **ECS via miniplex** (`ecs/` entities+components), **systems** (`systems/*` pure functions over the world), **scenes** (`game/scenes/*` Menu/Game with lifecycle), a `GameEngine` facade (`game/engine.ts`: `tick`/`startMatch`/`toMenu`/`setPaused`/`enqueueCommand`), and a typed **EventBus** (`game/eventBus.ts`) for discrete events. No React, no Pixi, **no store** imports.
- **Pixi** (`src/pixi/**`) — canvas rendering + input. Owns a `GameEngine`; `WorldRenderer` drives views from miniplex **reactive queries**; app-layer adapters subscribe the bus (audio) and push throttled snapshots to the store. No React imports.
- **React/UI** (`src/ui/**` — `App`, `GameCanvas`, `hud/`, `screens/`, `common/`, `hooks/`; plus `src/store/**`) — HUD/menus only. Talks to the Zustand store; never imports Pixi objects or ECS entities. (`src/store/**` stays outside `ui/` — the Pixi bridge reads it too.)

Data flow: **UI → command queue / control flags → GameEngine (scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. EventBus is a _supplement_ (discrete events: spawn/destroy/fire/gameOver/sceneChanged); the store stays the render-state channel. The single React↔Pixi seam is `GameCanvas` + `useGameApp`. Fixed-step 30 Hz loop + seeded RNG remain the deterministic backbone.

## Skills — load the matching one before editing a layer

Detailed, per-layer knowledge lives in `.claude/skills/` and auto-activates by task. Consult:

- **nether-engine** — `.claude/skills/nether-engine/SKILL.md` — ECS game core (`src/engine`): entities/components, systems, scenes, GameEngine, EventBus, pathfinding/obstacles/economy/tasks helpers.
- **nether-pixi** — `.claude/skills/nether-pixi/SKILL.md` — rendering/input (`src/pixi`): GameApp bridge, reactive-query `WorldRenderer`, entity views, camera, sprites/assets, pointer, bus/store adapters.
- **nether-react** — `.claude/skills/nether-react/SKILL.md` — HUD/state (`src/ui/**`, `src/store`): store snapshots/DTOs, command queue, control flags→engine, selectors, screens/hud/hotkeys.

## Project-wide conventions (tsconfig is strict)

- `erasableSyntaxOnly`: **no TS `enum`** (use the const-map + union pattern in `src/types/enums.ts`) and **no constructor parameter properties**.
- `verbatimModuleSyntax`: use `import type` for type-only imports.
- `noUnusedLocals`/`noUnusedParameters`: no dead symbols.

## Reference

- Engine internals: `.docs/engine-ecs.md` (ECS/miniplex), `.docs/movement.md` (pathfinding + movement), `.docs/zustand.md` (store rationale).
