# Drone Directive (web RTS)

Top-down RTS game built with **React 19 + PixiJS 8 + TypeScript + Vite + Zustand**.

## Monorepo (npm workspaces)

Five workspaces, in dependency order (each may only import from the ones above it):

- **`types/`** (`@drone-directive/types`) — value types shared across workspaces: `enums`, `commands`, `entities`, `tasks`. **Zero dependencies.** Imported by subpath (`@drone-directive/types/enums`).
- **`protocol/`** (`@drone-directive/protocol`) — the wire contract: `schema/messages.bare` plus its **committed** BARE codegen at `src/generated/messages.ts` (`@drone-directive/protocol/codec`); `src/index.ts` holds the handshake + framing constants and stays dependency-free so the Worker can route a frame without linking a decoder.
- **`net/`** (`@drone-directive/net`) — the online boundary: `LockstepSession` (transport), `wire/codec/` (domain ↔ BARE + framing), `wire/validation/` (valibot semantics). Depends on `types` + `protocol` and **nothing else** — no renderer, no React, no game config, no bundler globals. Anything match-specific (relay URL, world bounds) is injected by the host via `LockstepConfig`.
- **`client/`** (`@drone-directive/client`) — the web game; all app code, configs, `index.html`, and `public/` live here, source under `client/src/**`, build output `client/dist/`.
- **`server/`** (`@drone-directive/server`) — the online-multiplayer relay: a Cloudflare Worker + Durable Object; see `.docs/server-relay.md`.

Root scripts: `dev`/`build`/`preview` delegate to `client`; `test` runs `net` then `client`; `lint` is a single root `eslint .` covering **every** workspace; `type-check` chains `types`/`net`/`server`. Per-workspace extras: `npm run codegen -w protocol`, `npm run deploy -w server`, `npm run e2e -w server`. `npm run dev:relay` is a root alias for `npm run dev -w server`.

## Commands

Run from the repo root:

- `npm run dev` — Vite dev server (the game only; online play also needs `npm run dev:relay`).
- `npm run dev:relay` — the multiplayer relay Worker on `ws://localhost:8787`, which the client defaults to.
- `npm test` — Vitest: the `net` suite, then the engine suite (both must pass). Engine tests sit next to the systems (`client/src/engine/systems/*.test.ts`), net's under `net/src/wire/`. `npm run test:watch` (inside `client/`) to iterate.
- `npm run build` — production build (`tsc -b && vite build`, emits `client/dist`). Type-checks `types`/`net` transitively, since the client imports their sources.
- `npm run lint` — one root ESLint pass over **every** workspace.
- `npm run type-check` — `tsc --noEmit` for `types`, `net`, `server`. The server is **not** reached by `npm run build`, so this is the only thing that checks it.
- `npm run codegen -w protocol` — after editing `protocol/schema/messages.bare`; commit the regenerated output.

**Before considering any change done, run `npm run build`, `npm test`, and `npm run lint` (all clean); add `npm run type-check` when `server/`, `protocol/`, `net/` or `types/` changed.** For gameplay changes, also boot the dev server (on-screen behaviour can't be confirmed headless). For online changes, `npm run dev:relay` + `npm run e2e -w server`.

## Architecture (Scene-based + ECS core, three layers, strict boundaries)

- **Engine** (`client/src/engine/**`) — pure game core. **ECS via miniplex** (`ecs/` entities+components), **systems** (`systems/*` pure functions over the world), **scenes** (`game/scenes/*` Menu/Game with lifecycle), a `GameEngine` facade (`game/engine.ts`: `tick`/`startMatch`/`toMenu`/`setPaused`/`enqueueCommand`), and a typed **EventBus** (`game/eventBus.ts`) for discrete events. No React, no Pixi, **no store** imports.
- **Pixi** (`client/src/pixi/**`) — canvas rendering + input. Owns a `GameEngine`; `WorldRenderer` drives views from miniplex **reactive queries**; app-layer adapters subscribe the bus (audio) and push throttled snapshots to the store. No React imports.
- **React/UI** (`client/src/ui/**` — `App`, `GameCanvas`, `hud/`, `screens/`, `common/`, `hooks/`; plus `client/src/store/**`) — HUD/menus only. Talks to the Zustand store; never imports Pixi objects or ECS entities. (`client/src/store/**` stays outside `ui/` — the Pixi bridge reads it too.)

The online boundary is **not** one of these layers: it lives in the `net` workspace, so no game layer owns socket, codec, or validation code. `GameApp` is the only thing that touches it — it constructs a `LockstepSession` with `client/src/config/multiplayer.ts`'s `lockstepConfig`, which is where the relay URL and the world bounds are injected.

Data flow: **UI → command queue / control flags → GameEngine (scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. EventBus is a _supplement_ (discrete events: spawn/destroy/fire/gameOver/sceneChanged); the store stays the render-state channel. The single React↔Pixi seam is `GameCanvas` + `useGameApp`. Fixed-step 30 Hz loop + seeded RNG remain the deterministic backbone.

## Skills — load the matching one before editing a layer

Detailed, per-layer knowledge lives in `.claude/skills/` and auto-activates by task. Consult:

- **dd-engine** — `.claude/skills/dd-engine/SKILL.md` — ECS game core (`client/src/engine`): entities/components, systems, scenes, GameEngine, EventBus, pathfinding/obstacles/economy/tasks helpers.
- **dd-pixi** — `.claude/skills/dd-pixi/SKILL.md` — rendering/input (`client/src/pixi`): GameApp bridge, reactive-query `WorldRenderer`, entity views, camera, sprites/assets, pointer, bus/store adapters.
- **dd-react** — `.claude/skills/dd-react/SKILL.md` — HUD/state (`client/src/ui/**`, `client/src/store`): store snapshots/DTOs, command queue, control flags→engine, selectors, screens/hud/hotkeys.
- **dd-net** — `.claude/skills/dd-net/SKILL.md` — the online stack (`types/`, `protocol/`, `net/`, `server/`): BARE schema + codegen, tag-byte framing, lockstep transport, command validation, the relay Worker.

## Project-wide conventions (tsconfig is strict)

- Hand-written code **prefers** the const-map + union pattern in `types/src/enums.ts` over a TS `enum` (it stays a plain value at runtime and reads the same in every layer). `enum` is allowed, not banned — generated code such as `protocol/src/generated/**` emits it.
- `verbatimModuleSyntax`: use `import type` for type-only imports.
- `noUnusedLocals`/`noUnusedParameters`: no dead symbols.

## Reference

- Engine internals: `.docs/engine-ecs.md` (ECS/miniplex), `.docs/movement.md` (pathfinding + movement), `.docs/zustand.md` (store rationale).
- Online multiplayer: `.docs/multiplayer.md` (lockstep design, tick loop, determinism, validation), `.docs/server-relay.md` (the relay Worker + `Room` Durable Object), `.docs/deployment.md` (CI deploy of both halves).
- Library choices: `.docs/bare.md` (why BARE over protobuf, and how it keeps the relay content-blind), `.docs/valibot.md` (why a schema library validates peer input), `.docs/zustand.md` (store rationale).
- Workspace-level: `protocol/README.md` (BARE schema, codegen, framing), `net/README.md` (transport, codec, validation, injected config), `types/README.md`.
