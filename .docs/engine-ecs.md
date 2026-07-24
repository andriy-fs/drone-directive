# Engine Core — Why ECS, and What We Use From `miniplex`

`src/engine/**` is the pure game core: no React, no Pixi, no store imports
(see `CLAUDE.md`). It is organised as **ECS (entities + components) +
systems**, driven by **scenes**, behind a `GameEngine` facade, with a typed
**EventBus** as a side-channel for discrete events.

## Why ECS

The game has a small, fixed set of "kinds" (base, robot, projectile,
explosion, the observer drone) but a growing, cross-cutting set of
_behaviours_ that don't map cleanly onto a class-per-kind hierarchy:
movement, combat, vision, fog of war, tasks/AI scripting, economy,
production, separation (unit-unit push-apart), the drone's possession
mechanic. Several kinds share behaviours (bases and robots both take damage
and die via `reapSystem`; robots and the drone both have `position` and
`heading`), and some behaviours only apply to entities that happen to have
certain data (only entities with `movement` path through the pathfinder).

ECS fits this directly:

- **Entities** are just an `id` plus whichever optional components they carry
  (`src/engine/ecs/entity.ts`'s `Entity` interface — a flat bag of optional
  fields, no subclassing). A robot is `{ robot: true, position, movement,
weapon, script, threat, ... }`; a projectile is `{ projectile: true,
position, velocity, damage, ttl, ... }`. Adding new behaviour means adding a
  component + a system, not touching a class hierarchy.
- **Systems** are plain functions over the world (`src/engine/systems/*.ts`,
  each one `fooSystem(ctx, dt)`), run in a fixed order each tick by
  `GameScene.update` (`src/engine/game/scenes/gameScene.ts`). Order encodes
  real dependencies — e.g. `droneSystem` runs after `taskSystem` so it can
  override a possessed robot's target and steering, and `fogSystem` runs last
  so it reveals from this tick's _settled_ positions.
- **Boolean/object "tag" components** (`base?: true`, `robot?: true`,
  `drone?: Drone`) drive **archetype queries** — "give me every entity that
  has these components" — instead of `instanceof` checks or manual type
  discrimination.

This keeps the simulation data-oriented and composable: behaviour is decided
by what data an entity carries, not by what class it was constructed as, and
new features are additive (new component + new system) rather than invasive
edits to existing types.

## What we use from `miniplex`

`miniplex` (`^2.0.0`) supplies the actual ECS storage/query engine; we don't
hand-roll archetype indexing ourselves. Concretely, from
`src/engine/ecs/world.ts`:

```ts
import { World } from 'miniplex';
export type EcsWorld = World<Entity>;
export function createEcsWorld(): EcsWorld {
  return new World<Entity>();
}
```

What's used, and where:

- **`World<Entity>`** — the entity store itself. One instance lives for the
  whole app (`GameEngine.world`), not per-match — matches call `world.clear()`
  (`clearWorld`) and re-populate it, rather than recreating the store.
- **`world.add(entity)`** — inserts a new entity and returns it (with an
  auto-generated identity miniplex tracks internally). Used by every spawn
  function in `src/engine/ecs/factory.ts` (`spawnBase`, `spawnRobot`,
  `spawnDrone`, `spawnProjectile`, `spawnExplosion`) — each just builds a
  plain object literal with the relevant components and hands it to `add`.
- **`world.with(...tags)`** — archetype queries. This is the main way systems
  select entities, e.g. `ctx.world.with('robot', 'position', 'movement')` in
  `movementSystem`, or `ctx.world.with('base', 'production')` in
  `GameScene.enter`. TypeScript narrows the result to entities guaranteed to
  have those components (`With<Entity, ...>`), so systems don't need optional
  chaining on the fields they queried for.
- **`world.remove(entity)`** — used by `reapSystem` / `explosionSystem` /
  projectile TTL expiry to delete dead robots, spent projectiles, and expired
  explosion effects from the world.
- **`world.clear()`** — wipes every entity; used on match (re)start and on
  returning to the menu (`GameEngine.startMatch` / `toMenu` →
  `clearWorld(world)`).
- **Reactive queries — `query.onEntityAdded` / `query.onEntityRemoved`** —
  used _outside_ the engine, in the Pixi bridge
  (`src/pixi/render/WorldRenderer.ts`). `WorldRenderer` holds five `world.with(...)`
  queries (bases/robots/projectiles/explosions/drones) and subscribes to their
  add/remove events to create/destroy the matching Pixi view object
  (`BaseView`/`RobotView`/etc.) exactly when an entity enters/leaves that
  archetype — so view lifecycle is driven by ECS membership changes rather
  than manual diffing. A separate per-frame `sync()` iterates the same
  queries to push live component values (position, hp, selection) onto the
  already-created views.

Everything else — the fixed-order system pipeline, the `GameContext` (match
globals: resources, obstacles/nav grid, rng, AI/intel state, fog, drone
input), the `Scene`/`SceneManager` lifecycle, and the `EventBus` — is
hand-written, not part of miniplex; miniplex's job stops at "store entities,
query by component presence, notify on membership change."

## Why the EventBus, alongside the store

The EventBus (`src/engine/game/eventBus.ts`, `GameEngine.bus`) is a small,
dependency-free typed pub/sub: engine code `emit`s discrete moments
(`spawn`, `destroy`, `fire`, `gameOver`, `sceneChanged` — see
`src/engine/game/events.ts`), and app-layer adapters `on` them. It exists
because those moments are **events, not state** — a projectile firing, a
scene transition, a game-over — and don't fit naturally into the
throttled, snapshot-based Zustand store that drives React's re-renders.

The store remains the _render-state_ channel (HP bars, unit lists, resource
counts — anything the UI polls/derives every frame or on a throttle). The bus
is a _supplement_ for one-shot notifications the app layer wants to react to
directly and immediately (e.g. the audio adapter playing a sound effect on
`'fire'`, or the UI switching screens on `'sceneChanged'`) without having to
diff store snapshots to infer that something instantaneous happened.

## The `GameEngine` facade

`src/engine/game/engine.ts`'s `GameEngine` is the single object the app layer
(Pixi bridge) holds. It owns the persistent `world`, the `bus`, a
`SceneManager`, and the UI→engine command queue, and exposes only:
`tick(dt)`, `startMatch(settings)`, `toMenu()`, `setPaused(paused)`,
`setDroneControl(input)`, `enqueueCommand(command)`, plus read-only
`context`. The app layer never reaches into scene or system internals — this
is the one seam through which Pixi drives the engine and reads its world/bus.
