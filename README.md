# Drone Directive

**[▶ Play now](https://drone-directive.space/)**

A browser-based top-down real-time strategy game where you build, arm, and
program robots to destroy the enemy base before it destroys yours — solo against
a bot, or head-to-head online.

Built with **React 19 · PixiJS 8 · TypeScript · Vite · Zustand**.

It is an **educational project**, written to find out how far PixiJS can be
pushed in the shape of a real game: a WebGL canvas the size of the viewport, a
DOM interface on top of it, a simulation that has to stay exactly reproducible,
and none of the engine conveniences a native RTS would start from. Most of what
is in [`.docs/`](.docs/) is the record of that — including the ideas that were
measured and rejected.

- **What it plays like** → [`.docs/gameplay.md`](.docs/gameplay.md) (features,
  controls, how a match runs)
- **How it is put together** → [`.docs/architecture.md`](.docs/architecture.md)

## Getting started

Requires a recent Node.js (Vite 8 needs Node 20.19+ or 22.12+).

This is an **npm-workspaces monorepo** — the game lives in the `client`
workspace, the online relay in `server`, and four shared packages sit under them
(`types`, `protocol`, `net`, `chat`). Run everything from the repo root:
`npm install` installs all workspaces, and the root scripts cover them all.

```bash
npm install
npm run dev      # start the dev server (prints a local URL)
```

That runs the game only. **Online multiplayer additionally needs the relay
running** — `npm run dev:relay` in a second terminal (see below).

### Scripts

All run from the repo root.

| Command              | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Start the Vite dev server with HMR.                             |
| `npm run dev:relay`  | Start the multiplayer relay locally on `ws://localhost:8787`.   |
| `npm run build`      | Type-check and build for production (`tsc -b && vite build`).   |
| `npm run preview`    | Serve the production build locally.                             |
| `npm run lint`       | ESLint across **every** workspace.                              |
| `npm test`           | Vitest: the `net` suite, then `chat`, then the engine suite.    |
| `npm run type-check` | `tsc --noEmit` for what `build` never reaches (incl. `server`). |
| `npm run test:watch` | Run the client test suite in watch mode.                        |
| `npm run shot`       | Screenshot the running game (starts its own dev server).        |

Workspace-specific extras:

| Command                       | Description                                                           |
| ----------------------------- | --------------------------------------------------------------------- |
| `npm run e2e -w server`       | Frame-level end-to-end check against a running relay.                 |
| `npm run deploy -w server`    | Deploy the relay to Cloudflare (needs `npx wrangler login`).          |
| `npm run codegen -w protocol` | Recompile the BARE schema; commit the result (see `protocol/README`). |

Frame-time instrumentation (`?perf=1` and the per-layer switches) is documented
in [`.docs/performance.md`](.docs/performance.md).

### Online multiplayer (dev)

Solo vs. the bot by default; **Online (2P)** in the menu plays head-to-head.
This needs **two processes** — the root `dev` script starts the game only, so
without the relay the lobby fails to open a room. Use two terminals:

```bash
npm run dev:relay   # relay on ws://localhost:8787 (wrangler dev, no login needed)
npm run dev         # client; VITE_MULTIPLAYER_URL defaults to that relay
```

Open two tabs, host in one, join with the code in the other. Both tabs simulate
the same match — the host plays one side, the guest the other.

Two tabs of the **same** browser is the reliable setup. Two _different_ browsers
also work, but the lockstep simulation leans on `Math.sin`/`cos`, whose results
JS engines are not required to match bit for bit — a cross-engine match can
therefore desync (it ends with a `[desync]` line in the console).

For a deployed build, set `VITE_MULTIPLAYER_URL=wss://<your-worker-host>` at build
time; the relay deploys separately (`npm run deploy -w server`). How the backend
works is documented in [`.docs/server-relay.md`](.docs/server-relay.md), the CI
setup for both halves in [`.docs/deployment.md`](.docs/deployment.md).

## What is interesting in here

### A real-time strategy game that is entirely a web page

No native runtime, no WASM engine, no server authority. A 30 Hz fixed-step
simulation, A\* pathfinding, fog of war, formations and crowd avoidance all run
in the browser's main thread, alongside a React HUD, at a rendered frame budget
of 16.7 ms. The constraint that shapes everything else is **determinism**: the
same seed and the same orders must produce the same world, bit for bit, on two
different machines.

### Deterministic lockstep over a binary protocol

Online play sends **orders, not state**. Each peer transmits its per-tick
commands and both simulate the identical match from one shared seed, so the
bandwidth is independent of how many units are on the field.

Orders travel as **[BARE](https://baremessages.org/) frames** generated from a
schema (`protocol/schema/messages.bare`), with a one-byte tag for routing —
which is what lets the relay stay **content-blind**: the Cloudflare Worker and
its `Room` Durable Object pair two sockets, mint the seed, and forward bytes.
They run no game logic, store no match state, and never decode a payload.
Semantics are checked separately, at the client's own network boundary, with
valibot — the split between "is this shape legal" (BARE) and "is this order
legal" (valibot) is deliberate, and the filters are symmetric so a peer cannot
be made to accept what it would not send.

Rationale: [`.docs/multiplayer.md`](.docs/multiplayer.md) ·
[`.docs/bare.md`](.docs/bare.md) · [`.docs/valibot.md`](.docs/valibot.md) ·
[`.docs/server-relay.md`](.docs/server-relay.md).

### ORCA collision avoidance — and what it actually cost

Local avoidance is **ORCA** (Optimal Reciprocal Collision Avoidance, van den
Berg et al.), transcribed from the RVO2 reference and rebuilt to survive
lockstep: arithmetic restricted to `+ - * /` and `Math.sqrt` (never `Math.hypot`,
which is an algorithm rather than an operation and disagrees in the last bit
between engines — a rule a source-scanning test enforces), no trigonometry, no
clock, no
`Math.random`, and **zero allocation** — every buffer is claimed once per match
and the solver creates no object, array or closure per tick, asserted by test.

It replaced a one-sided "step around the obstacle" heuristic. Measured over 10
seeds × 2700 ticks of generated terrain, at fifty units, against that predecessor:

|                                                       | previous layer | ORCA    |
| ----------------------------------------------------- | -------------- | ------- |
| overlapping pairs per tick                            | 24.2           | **6.0** |
| anti-jam retreats                                     | 617            | 311     |
| robot-ticks crowding the enemy base, per arrived unit | 110            | **18**  |

Three conclusions worth keeping:

- **The interesting failures were not in the algorithm.** ORCA behaved; the
  deadlocks came from how the game registered agents into it. A unit standing
  still was registered as an immovable wall, so two parked robots 40 px apart
  left a gap A\* routes through and ORCA can never thread — and a unit caught
  there jitters ~2 px per tick forever, which the stall detector (measuring
  per-tick displacement) never reads as stuck. Arrived units yielding, plus a
  jam anchor that measures _net travel_ rather than per-tick motion, fixed both
  reported symptoms.
- **Symmetry has to be broken by geometry, not by a hash.** Two packs meeting
  exactly head-on livelocked when each unit picked its evade side from a hash of
  its id: opposite parities on opposite headings are the _same_ world side. A
  fixed turn sense — always the same rotation, roundabout-style — is always
  opposite world sides. That one is a lockstep-friendly answer as well as a
  correct one.
- **It is not free, and the honest number is the arrival time.** Reciprocity
  buys a fivefold drop in shoving at roughly +2% on mean arrival, and units near
  walls got slightly worse, not better. The trade was accepted with the metric
  on record rather than declared a win.

Design and measurements: [`.docs/movement.md`](.docs/movement.md).

### Decisions made by measurement, including the ones that said "no"

The pathfinder was very nearly replaced by a flow field. Instrumenting two real
matches killed it: A\* was costing ~20 500 cells over a whole match — about 143
cells per second — while the fields would have cost 8.4× more, and the group
routes a field could actually replace were **6%** of all pathfinding work. The
first metric that argued _for_ the change turned out to be circular. The
investigation is kept, rejected, rather than deleted.

Rendering went the same way. The terrain layer was profiled per-layer with an
in-game harness ([`.docs/performance.md`](.docs/performance.md)) reading **p95**
rather than mean frame time, and the culprit was not the suspected fog redraw
but a single `Sprite` used as a mask — which PixiJS 8 implements as a full
offscreen filter pass at device resolution with MSAA, costing more than the
entire terrain view it decorated.

### An ECS core with hard walls around it

The game core is **miniplex** ECS — entities as flat component bags, systems as
pure functions over the world — under a named archetype layer, so a system reads
`e.position.x` instead of asserting a component exists (non-null assertions are
lint-banned in the engine and the renderer). The renderer subscribes to
**reactive queries**: entity views appear and disappear because the world
changed, not because something told the renderer to draw them.

The three layers are enforced, not merely intended: the engine imports no React,
no Pixi and no store; the renderer imports no React; the UI imports no ECS
entity and no Pixi object. Networking belongs to none of them — it lives in its
own workspaces, so no game layer owns socket, codec or validation code.

### The rest of the sharp edges

- **Two Durable Objects, two lifetimes.** The match room is match-lifetime and
  content-blind; chat is a _separate_ socket to a hibernatable object that
  stores the conversation for 7 days and deliberately outlives the match it
  belongs to. Why it is not part of the lockstep stream:
  [`chat/README.md`](chat/README.md).
- **Code-split localization** (English, Russian, Ukrainian, Polish) that keeps
  the translation hook synchronous — one invariant does the whole job.
- **A themable interface over an unthemed battlefield.** The HUD names no colour
  of its own; a new scheme is one override file. Everything PixiJS draws stays on
  the game's own palette, because that is art direction, not theming.
- **Generated art pipeline.** PNG masters live outside the build and are
  re-encoded to the WebP the game ships.
- **Deployed as two independent halves** — static site and relay Worker, both on
  Cloudflare, from one script.

## Documentation

| Doc                                                        | Covers                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| [`.docs/gameplay.md`](.docs/gameplay.md)                   | Features, controls, and how a match flows.                         |
| [`.docs/architecture.md`](.docs/architecture.md)           | Workspaces, the three client layers, and the data flow.            |
| [`client/README.md`](client/README.md)                     | How engine, Pixi and UI talk to each other — the flow, diagrammed. |
| [`.docs/engine-ecs.md`](.docs/engine-ecs.md)               | The ECS model (miniplex) and the fixed-step system pipeline.       |
| [`.docs/movement.md`](.docs/movement.md)                   | Pathfinding (A\*), movement, formations, and ORCA avoidance.       |
| [`.docs/performance.md`](.docs/performance.md)             | The frame-time readout, per-layer bisection, and how to measure.   |
| [`.docs/zustand.md`](.docs/zustand.md)                     | Store rationale, snapshots, and the UI↔engine seam.                |
| [`.docs/multiplayer.md`](.docs/multiplayer.md)             | Online design: lockstep, the tick loop, determinism, validation.   |
| [`.docs/server-relay.md`](.docs/server-relay.md)           | How the relay Worker + the `Room` and `Chat` objects are built.    |
| [`.docs/bare.md`](.docs/bare.md)                           | Why BARE over protobuf, and how it keeps the relay dumb.           |
| [`.docs/valibot.md`](.docs/valibot.md)                     | Why peer input is validated with a schema library.                 |
| [`.docs/deployment.md`](.docs/deployment.md)               | Deploying the static site and the relay from CI.                   |
| [`protocol/README.md`](protocol/README.md)                 | The BARE schema, codegen, and frame layout.                        |
| [`net/README.md`](net/README.md)                           | Transport, codec, validation, and the config injected into them.   |
| [`chat/README.md`](chat/README.md)                         | Why chat is not in the lockstep stream, and its two departures.    |
| [`types/README.md`](types/README.md)                       | What earns a place in the shared types package.                    |
| [`client/src/theme/README.md`](client/src/theme/README.md) | Adding an interface theme.                                         |

## Credits

An independent, educational RTS built as a personal project.
Licensed under [GPL-3.0-or-later](LICENSE).
