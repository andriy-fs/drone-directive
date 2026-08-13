# Engine Core — Why ECS, and What We Use From `miniplex`

`client/src/engine/**` is the pure game core: no React, no Pixi, no store imports
(see `CLAUDE.md`). It is organised as **ECS (entities + components) +
systems**, driven by **scenes**, behind a `GameEngine` facade, with a typed
**EventBus** as a side-channel for discrete events.

## Why ECS

The game has a small, fixed set of "kinds" (base, robot, projectile,
explosion, the observer drone, the FPV strike drone) but a growing, cross-cutting set of
_behaviours_ that don't map cleanly onto a class-per-kind hierarchy:
movement, combat, vision, fog of war, tasks/AI scripting, economy,
production, separation (unit-unit push-apart), the drone's possession
mechanic. Several kinds share behaviours (bases and robots both take damage
and die via `reapSystem`; robots and the drone both have `position` and
`heading`), and some behaviours only apply to entities that happen to have
certain data (only entities with `movement` path through the pathfinder).

The FPV strike drone shows the other edge of the same trade — when *not* to reuse
a kind. It is airborne, shootable and short-lived, so wearing the `drone` tag
would have handed it flight and anti-air for free; but four things read that tag
as "this side's eye" (`droneRespawnSystem`, `DroneView`, `store.droneStatus`,
robot possession), and five munitions would have looked to them like five lost
eyes. So it got a tag of its own, `munition`, and what the two flyers genuinely
share was lifted into a *predicate* instead: `isAirTarget` in
`systems/targeting.ts` is what "air" means to vision, to the base battery and to
`hitsAimedAir`. Component identity says what a thing **is**; a predicate over
components says what it **counts as** — and a third flyer is now one line in
`targeting.ts` rather than a hunt through three systems.

`munitionSystem` is where a strike drone's whole life happens, and it runs
immediately after `combatSystem` (which launches them) and before `shieldSystem`
(so a hit on a base reaches the dome in the same tick's accounting as a shell).
Notably it never reaches `reapSystem`: a munition is not a robot, base or drone,
raises no `entityDestroyed`, and nothing holds a reference to clean up — so
letting the generic reaper see it would only add a case that means nothing.

The base's built-in missile battery is the cleanest illustration of the payoff.
Making a *building* shoot cost no new mechanism at all: `spawnBase` grew a
`weapon` component (the same one `spawnRobot` builds, through a shared
`weaponComp`), `taskSystem` grew a short pass that writes `targetId` on bases the
way it already did on robots, and `combatSystem` grew a second query over the
`base` archetype feeding the *same* `fireWeapon`. No class had to learn that a
building is now a kind of shooter — it simply has the components a shooter has.

ECS fits this directly:

- **Entities** are just an `id` plus whichever optional components they carry
  (`client/src/engine/ecs/entity.ts`'s `Entity` interface — a flat bag of optional
  fields, no subclassing). A robot is `{ robot: true, position, movement,
weapon, script, threat, ... }`; a projectile is `{ projectile: true,
position, velocity, damage, ttl, ... }`. Adding new behaviour means adding a
  component + a system, not touching a class hierarchy. A **temporary** state is
  a component too, and its absence is the "off" state: a robot knocked out by a
  directed-energy hit carries `disabled: {left}` until it expires, at which point
  the component is dropped rather than zeroed (see `systems/status.ts`, which
  owns every read and write of it, and decays it in `taskSystem`). `regenLock:
  {left}` — the pause on passive repair after a hit — works the same way, but is
  carried by bases as well as robots and decays in `regenSystem`. A base's
  energy dome, `shield: {hp,left}`, is the same idea taken one step further: it
  is not merely temporary, it is a **query tag**, so raising and losing it moves
  the base in and out of `world.with('base','position','shield')` and the Pixi
  view is created and destroyed by that membership change alone. That is also
  the one rule about it — miniplex only re-evaluates a query through
  `world.addComponent`/`world.removeComponent`, so `systems/shield.ts` is the
  sole owner of both calls, and a direct `base.shield = {...}` would be invisible
  to every query in the game. Its companion `shieldSpent` is *not* transient: it
  has to outlive the dome, because there is only one per match.
- **Systems** are plain functions over the world (`client/src/engine/systems/*.ts`,
  each one `fooSystem(ctx, dt)`), run in a fixed order each tick by
  `GameScene.update` (`client/src/engine/game/scenes/gameScene.ts`). Order encodes
  real dependencies — e.g. `droneSystem` runs after `taskSystem` so it can
  override a possessed robot's target and steering, and `fogSystem` runs last
  so it reveals from this tick's _settled_ positions.
- **Boolean/object "tag" components** (`base?: true`, `robot?: true`,
  `drone?: Drone`, `munition?: true`) drive **archetype queries** — "give me
  every entity that has these components" — instead of `instanceof` checks or
  manual type discrimination.

This keeps the simulation data-oriented and composable: behaviour is decided
by what data an entity carries, not by what class it was constructed as, and
new features are additive (new component + new system) rather than invasive
edits to existing types.

## What we use from `miniplex`

`miniplex` (`^2.0.0`) supplies the actual ECS storage/query engine; we don't
hand-roll archetype indexing ourselves. Concretely, from
`client/src/engine/ecs/world.ts`:

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
  function in `client/src/engine/ecs/factory.ts` (`spawnBase`, `spawnRobot`,
  `spawnDrone`, `spawnProjectile`, `spawnExplosion`) — each just builds a
  plain object literal with the relevant components and hands it to `add`.
  `factory.ts` is the **only** caller of `world.add` in the codebase, which is
  what the archetype layer below rests on.
- **`world.with(...tags)`** — archetype queries, and the reason systems can read
  `e.position.x` rather than `e.position!.x`: TypeScript narrows the result to
  `With<Entity, ...>`, entities guaranteed to have those components.
  Systems never call it inline. They go through
  `client/src/engine/ecs/queries.ts`, which declares each query once and returns
  it typed as a named archetype from `client/src/engine/ecs/archetypes.ts`
  (`Query<RobotEntity>`, `Query<ShieldedBase>`, …). See "The archetype layer"
  below for why those queries ask for the *full* spawner shape.
- **`world.remove(entity)`** — used by `reapSystem` / `explosionSystem` /
  `munitionSystem` / projectile TTL expiry to delete dead robots, spent
  projectiles, downed strike drones, and expired explosion effects from the
  world.
- **`world.clear()`** — wipes every entity; used on match (re)start and on
  returning to the menu (`GameEngine.startMatch` / `toMenu` →
  `clearWorld(world)`).
- **Reactive queries — `query.onEntityAdded` / `query.onEntityRemoved`** —
  used _outside_ the engine, in the Pixi bridge
  (`client/src/pixi/render/WorldRenderer.ts`). `WorldRenderer` holds seven
  archetype-typed queries (from the same `ecs/queries.ts`) (bases/robots/projectiles/explosions/drones/strike drones, plus bases
  whose energy dome is currently up) and subscribes to their
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

## The archetype layer

`Entity` is a flat bag of ~30 optional components. That is what miniplex's
`World<E>` needs, and it is what lets `world.addComponent` bolt a dome onto a
base mid-match — but on its own it made every system assert what it had already
selected for. The engine and the Pixi bridge together carried **213 non-null
assertions**, and the handful that guarded a real risk looked exactly like the
~180 that were pure noise.

Three files fix that without changing the storage model:

- **`ecs/archetypes.ts`** — one named shape per entity kind (`RobotEntity`,
  `BaseEntity`, `DroneEntity`, `MunitionEntity`, `ProjectileEntity`,
  `ExplosionEntity`), plus the facets a kind-agnostic helper wants
  (`Positioned`, `Owned`, `Living`, `Navigable`), the `Shooter` union and
  `ShieldedBase`. Each is `With<Entity, (typeof X_KEYS)[number]>` over a key
  tuple copied from the matching spawner.
- **`ecs/queries.ts`** — each archetype query declared once. `World.with()`
  already "creates (or reuses)" a cached query, so these are plain functions
  rather than a registry object with its own lifecycle.
- **`ecs/guards.ts`** — `isRobot`/`isBase`/… derived from the *same* key tuples,
  so a guard can never claim more than it checks. Only for `findById`, the one
  lookup whose result really is of unknown shape.

### Why the queries ask for the whole spawner shape

`with('robot', 'position', 'movement')` narrows to three components — not to a
robot. Closing that gap with a cast would put the assertions back, one per
query instead of one per read. Instead the queries ask for **every** key the
spawner sets, which selects exactly the same entities:

1. `factory.ts` is the only caller of `world.add`.
2. The only components ever attached or detached afterwards are `shield` and
   `shieldSpent`, in `systems/shield.ts`.

So an entity's component set is fixed at spawn, no robot has ever lacked
`weapon` or `script`, and widening is behaviour-neutral **by construction**.
What it buys is that the return type in `queries.ts` is *checked* by the
compiler rather than asserted — there is no `as` anywhere in the chain, and
none left in `WorldRenderer` either. The factory annotations close the loop:
`add<D extends E>(entity: D)` infers `D` from the object literal, so a spawner
that forgets a field fails to compile, and the key tuples cannot drift.

**Adding a component:** if it can come and go mid-match, it must *not* join a
key tuple. Give it an intersection type and its own query, the way
`ShieldedBase` handles the dome — otherwise the query silently stops matching
the entities that lack it.

`@typescript-eslint/no-non-null-assertion` is enabled for
`client/src/engine/**` and `client/src/pixi/**` (tests excluded, since they poke
fields on deliberately wide `Entity` handles so a broken schema cannot hide
behind an archetype). That rule is the ratchet: a new `!` there means the wrong
type was reached for — take the entity from a query, type the helper with the
archetype its caller already has, or use a guard.

## Why the EventBus, alongside the store

The EventBus (`client/src/engine/game/eventBus.ts`, `GameEngine.bus`) is a small,
dependency-free typed pub/sub: engine code `emit`s discrete moments
(`spawn`, `destroy`, `fire`, `gameOver`, `sceneChanged` — see
`client/src/engine/game/events.ts`), and app-layer adapters `on` them. It exists
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

`client/src/engine/game/engine.ts`'s `GameEngine` is the single object the app layer
(Pixi bridge) holds. It owns the persistent `world`, the `bus`, a
`SceneManager`, and the UI→engine command queue, and exposes only:
`tick(dt)`, `startMatch(settings)`, `toMenu()`, `setPaused(paused)`,
`setDroneControl(input)`, `enqueueCommand(command)`, plus read-only
`context`. The app layer never reaches into scene or system internals — this
is the one seam through which Pixi drives the engine and reads its world/bus.
