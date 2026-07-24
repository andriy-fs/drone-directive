# Why Zustand

`src/store/**` holds the Zustand store (`useGameStore`, `src/store/gameStore.ts`).
Per `CLAUDE.md`, it's the one **render-state channel** between the Pixi/engine
world and the React UI, and it deliberately sits outside `src/ui/**` — "the
Pixi bridge reads it too."

## The problem it solves: React and Pixi are two separate worlds

The engine (`src/engine/**`) and its Pixi-driven loop (`src/pixi/**`) run
their own fixed-step simulation and know nothing about React. React
(`src/ui/**`) renders the HUD/menus and knows nothing about ECS entities or
Pixi objects (enforced by `CLAUDE.md`'s layering rules — UI never imports
Pixi objects or ECS entities). Something has to be the seam where:

- UI actions (clicks, key presses, dropdown changes) reach the engine, and
- engine results (HP, positions→snapshots, resources, win/lose, drone status)
  reach the UI,

...without either side importing the other's internals. Zustand is that
seam, because a Zustand store is **not tied to the React render tree** — it's
a plain external object with a subscribe API that React hooks into, but that
non-React code can read and write imperatively too.

## What this buys, concretely

**1. Callable from outside React, subscribable from inside it.**
`src/pixi/GameApp.ts` (no React import) calls `useGameStore.getState()` every
fixed step to read control flags (`paused`, `droneInput`, restart/menu
requests) and to write projected results back (`setBases`, `setRobots`,
`setResources`, `setDroneStatus`) — see `GameApp.step()` /
`GameApp.pushSnapshot()`. Meanwhile React components use the same store via
the `useGameStore(selector)` hook and re-render reactively. One store, two
completely different call conventions, no context provider needed to bridge
them.

**2. Selector-based subscriptions avoid blanket re-renders.**
`src/store/selectors.ts` exports narrow selectors (`selectRobots`,
`selectResources`, `selectSelectedIds`, ...) — "so components subscribe to
the smallest slice they need (zustand re-renders a component only when its
selected value changes)." Without this, any store update (and the engine
pushes many) would re-render the entire HUD tree; with it, e.g.
`ProgrammingPanel` only re-renders when the robots slice actually changes.

**3. Decouples simulation tick rate from React's render rate.**
The engine ticks at a fixed 30 Hz; React shouldn't re-render that often.
`GameApp` only calls `pushSnapshot()` every `gameConfig.hud.snapshotEveryTicks`
steps (plus immediately on discrete bus events like `entitySpawned` /
`gameOver`) — throttling how often the store (and therefore React) updates,
independent of how often the simulation itself advances.

**4. Two clean, typed traffic directions, matching the architecture doc's
data flow** (`CLAUDE.md`: _UI → command queue / control flags → GameEngine →
EventBus + throttled store snapshots → UI_):

- **UI → engine**: `enqueueCommand`/`drainCommands` (a command queue the
  bridge drains into `engine.enqueueCommand` each step), plus one-shot control
  flags (`restartRequested`, `menuRequested`, `paused`, `droneInput`,
  `dronePossessRequested`, `droneFireRequested`) that the bridge reads and
  clears.
- **engine → UI**: snapshot setters (`setBases`, `setRobots`, `setResources`,
  `setDroneStatus`) fed by `GameApp.pushSnapshot()`, which projects
  HUD-facing DTOs (`BaseSnapshot`, `RobotSnapshot`, `DroneStatus`) out of the
  live ECS world — the UI never sees a raw `Entity`.

**5. Minimal ceremony.** `create<GameState>((set, get) => ({ ...initialState,
...actions }))` is the entire store definition — no provider component, no
reducer/action-type boilerplate, no context nesting. State and the actions
that mutate it live in one typed object, which keeps `GameState` (in
`gameStore.ts`) as a single readable contract for everything that crosses the
UI↔engine boundary.

## What deliberately does _not_ go through the store

Discrete one-shot moments (a shot fired, an entity destroyed, a scene change,
game over) go through the **EventBus** (`src/engine/game/eventBus.ts`)
instead — see `.docs/engine-ecs.md`. The store models continuous
render _state_ (what the HUD currently shows); the bus models _events_ app-layer
adapters react to once (playing a sound, triggering a snapshot push, flipping
`status`). Routing everything through the store would mean polling/diffing
snapshots to detect instantaneous occurrences; the bus lets engine code just
say "this happened" once.
