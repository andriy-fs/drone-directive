# Drone Directive (web RTS)

Top-down RTS game built with **React 19 + PixiJS 8 + TypeScript + Vite + Zustand**.

## Monorepo (npm workspaces)

Six workspaces, in dependency order (each may only import from the ones above it).
`net/` and `chat/` are **siblings** — neither imports the other:

```
types/  →  protocol/  →  { net/ , chat/ }  →  client/ , server/
```

- **`types/`** (`@drone-directive/types`) — value types shared across workspaces: `enums`, `commands`, `entities`, `tasks`. **Zero dependencies.** Imported by subpath (`@drone-directive/types/enums`).
- **`protocol/`** (`@drone-directive/protocol`) — the wire contract: `schema/messages.bare` plus its **committed** BARE codegen at `src/generated/messages.ts` (`@drone-directive/protocol/codec`); `src/index.ts` holds the handshake + framing constants and stays dependency-free so the Worker can route a frame without linking a decoder.
- **`net/`** (`@drone-directive/net`) — the online boundary: `LockstepSession` (transport), `wire/codec/` (domain ↔ BARE + framing), `wire/validation/` (valibot semantics). Depends on `types` + `protocol` and **nothing else** — no renderer, no React, no game config, no bundler globals. Anything match-specific (relay URL, world bounds) is injected by the host via `LockstepConfig`.
- **`chat/`** (`@drone-directive/chat`) — the chat boundary and a sibling of `net/` under the same rules: `ChatSession` (one socket to one `Chat` Durable Object, with reconnect), `wire/codec.ts`, `wire/validation.ts`. Relay URL injected via `ChatConfig`. Two deliberate departures from `net/`, both documented in `chat/README.md`: the object on the other end **decodes** payloads (it numbers and stores them), and validation is **asymmetric** (chat touches no simulation, so the server is simply authoritative).
- **`client/`** (`@drone-directive/client`) — the web game; all app code, configs, `index.html`, and `public/` live here, source under `client/src/**`, build output `client/dist/`. The sprite art in `public/` is **generated**: PNG masters live in `client/assets-src/sprites/` (outside the build) and `client/scripts/encode-sprites.mjs` re-encodes them to the WebP the game ships — edit the master and re-run, never the file in `public/`. See `.docs/sprites/README.md`.
- **`server/`** (`@drone-directive/server`) — the online-multiplayer relay: a Cloudflare Worker plus two Durable Objects — `Room` (match-lifetime, content-blind, two sockets) and `Chat` (hibernatable, stores the conversation for 7 days); see `.docs/server-relay.md`.

Root scripts: `dev`/`build`/`preview` delegate to `client`; `test` runs `net`, then `chat`, then `client`; `lint` is a single root `eslint .` covering **every** workspace; `type-check` chains `types`/`net`/`chat`/`server`. Per-workspace extras: `npm run codegen -w protocol`, `npm run deploy -w server`, `npm run e2e -w server`. `npm run dev:relay` is a root alias for `npm run dev -w server`.

## Commands

Run from the repo root:

- `npm run dev` — Vite dev server (the game only; online play also needs `npm run dev:relay`).
- `npm run dev:relay` — the multiplayer relay Worker on `ws://localhost:8787`, which the client defaults to.
- `npm test` — Vitest: the `net` suite, then `chat`, then the engine suite (all must pass). Engine tests sit next to the systems (`client/src/engine/systems/*.test.ts`), net's and chat's under their `src/wire/`. `npm run test:watch` (inside `client/`) to iterate.
- `npm run build` — production build (`tsc -b && vite build`, emits `client/dist`). Type-checks `types`/`net`/`chat` transitively, since the client imports their sources.
- `npm run lint` — one root ESLint pass over **every** workspace.
- `npm run type-check` — `tsc --noEmit` for `types`, `net`, `chat`, `server`. The server is **not** reached by `npm run build`, so this is the only thing that checks it.
- `npm run codegen -w protocol` — after editing `protocol/schema/messages.bare`; commit the regenerated output.

**Before considering any change done, run `npm run build`, `npm test`, and `npm run lint` (all clean); add `npm run type-check` when `server/`, `protocol/`, `net/`, `chat/` or `types/` changed.** For gameplay changes, also boot the dev server (on-screen behaviour can't be confirmed headless). For online changes, `npm run dev:relay` + `npm run e2e -w server`.

## Architecture (Scene-based + ECS core, three layers, strict boundaries)

- **Engine** (`client/src/engine/**`) — pure game core. **ECS via miniplex** (`ecs/` entities+components), **systems** (`systems/*` pure functions over the world), **scenes** (`game/scenes/*` Menu/Game with lifecycle), a `GameEngine` facade (`game/engine.ts`: `tick`/`startMatch`/`toMenu`/`setPaused`/`enqueueCommand`), and a typed **EventBus** (`game/eventBus.ts`) for discrete events. No React, no Pixi, **no store** imports.
- **Pixi** (`client/src/pixi/**`) — canvas rendering + input. Owns a `GameEngine`; `WorldRenderer` drives views from miniplex **reactive queries**; app-layer adapters subscribe the bus (audio) and push throttled snapshots to the store. Audio is sample files played through `@pixi/sound` (table in `client/src/config/sounds.ts`, files in `client/public/sounds/`, briefs in `.docs/sfx/README.md`) and runs off **three** channels: the bus for what the simulation does (shots, explosions, a robot leaving the factory), a store subscription for what the player picks (selection is store-only state the engine never hears about), and direct calls from `ui/common/` for the interface itself. No React imports.
- **React/UI** (`client/src/ui/**` — `App`, `GameCanvas`, `hud/`, `screens/`, `common/`, `hooks/`; plus `client/src/store/**`) — HUD/menus only. Talks to the Zustand store; never imports Pixi objects or ECS entities. (`client/src/store/**` stays outside `ui/` — the Pixi bridge reads it too.)

The online boundary is **not** one of these layers: it lives in the `net` and `chat` workspaces, so no game layer owns socket, codec, or validation code. `GameApp` is the only thing that touches `net` — it constructs a `LockstepSession` with `client/src/config/multiplayer.ts`'s `lockstepConfig`, which is where the relay URL and the world bounds are injected. Chat is the exception that proves the rule: it must **outlive** the match, so `client/src/chat/chatBridge.ts` owns its `ChatSession` as a module singleton outside `pixi/`, and nothing in `GameApp`'s teardown touches it.

Data flow: **UI → command queue / control flags → GameEngine (scenes → systems over ECS) → EventBus + throttled store snapshots → UI**. EventBus is a _supplement_ (discrete events: spawn/destroy/fire/gameOver/sceneChanged); the store stays the render-state channel. The single React↔Pixi seam is `GameCanvas` + `useGameApp`. Fixed-step 30 Hz loop + seeded RNG remain the deterministic backbone.

## Skills — load the matching one before editing a layer

Detailed, per-layer knowledge lives in `.claude/skills/` and auto-activates by task. Consult:

- **dd-engine** — `.claude/skills/dd-engine/SKILL.md` — ECS game core (`client/src/engine`): entities/components, systems, scenes, GameEngine, EventBus, pathfinding/obstacles/economy/tasks helpers.
- **dd-pixi** — `.claude/skills/dd-pixi/SKILL.md` — rendering/input (`client/src/pixi`): GameApp bridge, reactive-query `WorldRenderer`, entity views, camera, sprites/assets, pointer, bus/store adapters.
- **dd-react** — `.claude/skills/dd-react/SKILL.md` — HUD/state (`client/src/ui/**`, `client/src/store`): store snapshots/DTOs, command queue, control flags→engine, selectors, screens/hud/hotkeys.
- **dd-net** — `.claude/skills/dd-net/SKILL.md` — the online stack (`types/`, `protocol/`, `net/`, `server/`): BARE schema + codegen, tag-byte framing, lockstep transport, command validation, the relay Worker + `Room` Durable Object.
- **dd-chat** — `.claude/skills/dd-chat/SKILL.md` — in-match chat (`chat/`, `server/src/Chat.ts`, `client/src/chat/**`, `ChatPanel`): the second socket to the second Durable Object, history/retention/presence, and why it must outlive the match.
- **dd-i18n** — `.claude/skills/dd-i18n/SKILL.md` — UI localization (`client/src/i18n/**`, `locale` in the store, the language picker, the boot placeholder): code-split dictionaries, the invariant that keeps `useT()` synchronous, and how to add a language.

## Project-wide conventions (tsconfig is strict)

- Hand-written code **prefers** the const-map + union pattern in `types/src/enums.ts` over a TS `enum` (it stays a plain value at runtime and reads the same in every layer). `enum` is allowed, not banned — generated code such as `protocol/src/generated/**` emits it.
- `verbatimModuleSyntax`: use `import type` for type-only imports.
- `noUnusedLocals`/`noUnusedParameters`: no dead symbols.

## Reference

- Engine internals: `.docs/engine-ecs.md` (ECS/miniplex), `.docs/movement.md` (pathfinding + movement), `.docs/zustand.md` (store rationale).
- Online multiplayer: `.docs/multiplayer.md` (lockstep design, tick loop, determinism, validation, chat), `.docs/server-relay.md` (the relay Worker + the `Room` and `Chat` Durable Objects), `.docs/chat.md` (what chat is built out of and why), `.docs/deployment.md` (CI deploy of both halves).
- Library choices: `.docs/bare.md` (why BARE over protobuf, and how it keeps the relay content-blind), `.docs/valibot.md` (why a schema library validates peer input), `.docs/zustand.md` (store rationale).
- Workspace-level: `protocol/README.md` (BARE schema, codegen, framing), `net/README.md` (transport, codec, validation, injected config), `chat/README.md` (why chat is not in the lockstep stream, and its two departures from `net/`), `types/README.md`.
