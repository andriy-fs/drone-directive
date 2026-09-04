# Architecture

How the repository is laid out, which parts may depend on which, and how the
game core, the renderer and the UI talk to each other. Per-area detail lives in
the documents linked from each section, and [`client/README.md`](../client/README.md)
draws the engine↔Pixi↔UI flow out in full.

## The monorepo

Six npm workspaces. The dependency direction is one-way — each may only import
from the ones above it, and `net/` and `chat/` are **siblings** that never
import each other:

```
types/  →  protocol/  →  { net/ , chat/ }  →  client/ , server/
```

- **`types/`** — value types shared across workspaces (`enums`, `commands`,
  `entities`, `tasks`). Zero dependencies, imported by subpath; see
  [`types/README.md`](../types/README.md).
- **`protocol/`** — the wire contract. `schema/messages.bare` is the source of
  truth; `src/generated/messages.ts` is its committed BARE codegen; `src/index.ts`
  holds the handshake and framing constants, dependency-free so the relay can
  route a frame without linking a decoder. See
  [`protocol/README.md`](../protocol/README.md).
- **`net/`** — the online boundary: `LockstepSession` (transport), `wire/codec/`
  (domain ↔ BARE + framing), `wire/validation/` (valibot semantics). Depends on
  the two above and nothing else — no renderer, no React, no game config, no
  bundler globals. Anything match-specific (relay URL, world bounds) is injected
  by the host through `LockstepConfig`. See [`net/README.md`](../net/README.md).
- **`chat/`** — the chat boundary, a sibling of `net/` under the same rules:
  `ChatSession` (one socket to one `Chat` Durable Object, with reconnect), its
  codec and validation, relay URL injected via `ChatConfig`. Two deliberate
  departures from `net/` are documented in [`chat/README.md`](../chat/README.md).
- **`client/`** — the game itself (below): all app code, configs, `index.html`
  and `public/`, source under `client/src/**`, build output `client/dist/`.
- **`server/`** — the online-multiplayer relay: a Cloudflare Worker plus two
  Durable Objects — `Room` (match-lifetime, content-blind, two sockets) and
  `Chat` (hibernatable, stores the conversation for 7 days). The Worker runs no
  game logic, stores no match state, and never decodes a payload — see
  [server-relay.md](server-relay.md).

## Inside the client: three layers

- **Engine** (`client/src/engine/**`) — the pure game core. **ECS via miniplex**
  (`ecs/` entities + components), **systems** (pure functions over the world:
  movement/pathfinding, combat, tasks, AI, economy, production, vision, fog,
  shield, reap…), Menu/Game **scenes**, a `GameEngine` facade
  (`tick`/`startMatch`/`toMenu`/`setPaused`/`enqueueCommand`), and a typed
  **EventBus** for discrete events. No React, no Pixi, no store imports.
  `Entity` stays a flat bag of optional components (miniplex needs that, and it
  is what lets a dome be bolted on mid-match), with a **named archetype layer**
  over it — `ecs/archetypes.ts` + `ecs/queries.ts` + `ecs/guards.ts` — so a
  system reads `e.position.x` rather than asserting it. See
  [engine-ecs.md](engine-ecs.md).
- **Pixi** (`client/src/pixi/**`) — canvas rendering and input. Owns a
  `GameEngine`; `WorldRenderer` drives views from miniplex **reactive queries**;
  app-layer adapters subscribe to the bus (audio) and push throttled snapshots
  to the store. Audio runs off three channels: the bus for what the simulation
  does, a store subscription for what the player picks, and direct calls from
  `ui/common/` for the interface itself. No React imports. Networking is
  deliberately not a layer of its own here: `GameApp` constructs a
  `LockstepSession` from the `net` workspace, and that is the whole of its
  involvement.
- **React/UI** (`client/src/ui/**` — `App`, `GameCanvas`, `hud/`, `screens/`,
  `common/`, `hooks/`; plus `client/src/store/**`) — HUD and menus only. Talks to
  the Zustand store; never imports Pixi objects or ECS entities.
  (`client/src/store/**` sits outside `ui/` because the Pixi bridge reads it
  too.) The interface's look is tokenised: `ui/App.css` names no colour, font or
  radius of its own but reads roles from `client/src/theme/**`, where
  `tokens.css` holds the base scheme and each alternative is one
  `[data-theme='…']` override file. The **battlefield** is not themed —
  everything Pixi draws comes from `config/palette.ts`.

Chat is the exception that proves the layering rule: it must **outlive** the
match, so `client/src/chat/chatBridge.ts` owns its `ChatSession` as a module
singleton outside `pixi/`, and nothing in `GameApp`'s teardown touches it.

## Data flow

**UI → command queue / control flags → GameEngine (scenes → systems over ECS) →
EventBus + throttled store snapshots → UI.**

The EventBus is a _supplement_ — discrete events (spawn, destroy, fire,
gameOver, sceneChanged); the store stays the render-state channel. The only
React↔Pixi seam is `GameCanvas` + `useGameApp`. A fixed-step 30 Hz loop and a
seeded RNG are the deterministic backbone, which is what makes lockstep
multiplayer possible at all. See [zustand.md](zustand.md) for the store
rationale.

## Directory map

```
client/           # @drone-directive/client — the game (app code, configs, index.html)
  src/
    engine/     # game core (no React/Pixi/store)
      ecs/      #   entities (components), archetypes, queries, guards, world, factory
      systems/  #   ai/, combat/ (+munition, shield), movement/ (+avoidance, orca/),
                #   vision/ (+fog), task/, commands, production, drone, separation,
                #   economy, reap, regen, droneRespawn, explosion
      game/     #   engine (facade), scene + scenes/, eventBus, events, context
      (helpers) #   pathfinding, obstacles, economy, tasks/, targeting, threat, status
    pixi/       # GameApp (bridge), GameLoop, Camera, layers, assets, input/, render/
    ui/         # React: App, GameCanvas, hud/, screens/, common/, hooks/
    store/      # gameStore (Zustand) + selectors (shared with the Pixi bridge)
    chat/       # chatBridge — the ChatSession that outlives the match
    config/     # gameConfig, palette, sprites, multiplayer, sounds
    theme/      # tokens.css + one file per alternative scheme
    i18n/       # code-split locale dictionaries (en/ru/uk/pl)
  assets-src/   # PNG sprite masters (outside the build)
  public/       # static assets — the generated WebP the game ships
types/            # @drone-directive/types — enums, commands, entities, tasks (no deps)
protocol/         # @drone-directive/protocol — schema/messages.bare + committed codegen + framing
net/              # @drone-directive/net — lockstep/ (transport) + wire/{codec,validation}
chat/             # @drone-directive/chat — ChatSession + wire/{codec,validation}
server/           # @drone-directive/server — relay Worker: index.ts + Room.ts + Chat.ts
```

## Conventions

- Hand-written code **prefers** the const-map + union pattern in
  `types/src/enums.ts` over a TS `enum` — it stays a plain value at runtime and
  reads the same in every layer. `enum` is allowed, not banned: generated code
  such as `protocol/src/generated/**` emits it.
- `verbatimModuleSyntax` — use `import type` for type-only imports.
- `noUnusedLocals` / `noUnusedParameters` — no dead symbols.
- `@typescript-eslint/no-non-null-assertion` is enforced in `engine/**` and
  `pixi/**`; the archetype layer exists so it never needs to be waived.

## Sprites

The art in `client/public/` is **generated**. PNG masters live in
`client/assets-src/sprites/` (outside the build) and
`client/scripts/encode-sprites.mjs` re-encodes them to the WebP the game ships —
edit the master and re-run, never the file in `public/`.

Robot art is registered in `client/src/config/sprites.ts` (chassis → image, with
an optional crop frame). Missing entries fall back to a coloured shape, so art
can be added incrementally.
