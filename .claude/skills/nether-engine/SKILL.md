---
name: nether-engine
description: >-
  Knowledge for the Drone Directive game CORE (src/engine/**, src/types/**,
  src/config/gameConfig.ts). Use whenever a task changes game rules or structure:
  ECS entities/components, systems (movement/pathfinding, combat, tasks, AI,
  economy, production, reap, explosions), scenes, the GameEngine facade, the
  EventBus, obstacles, or difficulty. Explains the ECS model, the fixed-step
  system pipeline, and the no-Pixi/no-React/no-store rule.
---

# Drone Directive — Game core (ECS + scenes)

Pure, framework-free. **Never import React, Pixi, or the store here.** Uses **miniplex** for ECS.

## Layout

- `ecs/entity.ts` — `Entity` = a bag of optional components; boolean tags (`base/robot/projectile/explosion`) drive `world.with(...)` archetype queries. Components: `owner, position, heading, hp, maxHp, chassis, weaponType, movement{speed,state,destination,path,goal}, weapon{range,damage,cooldown,cooldownLeft,explosionRadius}, sightRange, script{programId,blackboard}, targetId, threat{attackerId,underFireLeft}, production{queue,progress,autoBuildPreset,autoBuildStep,defaultTask}, footprint, velocity, damage, ttl, sourceId (projectile shooter), effect{age,duration,maxRadius?}`.
- `ecs/world.ts` — `createEcsWorld()`, `clearWorld()`.
- `ecs/factory.ts` — `spawnBase/spawnRobot/spawnProjectile/spawnExplosion` (`world.add(...)`); `spawnRobot` sets `sightRange` from `gameConfig.robots.chassis[chassis].sight` (per-chassis); `spawnBase` sets it from `gameConfig.bases.sightRange`.
- `systems/*` — each is `(ctx: GameContext, dt?) => void`, iterating `ctx.world.with(...)`: `commands, economy, ai, production, vision, task, movement (exports setGoal/clearGoal), separation, combat, reap (returns bool), explosion`, plus `targeting.ts` helpers (`isEnemy/findById/enemyRobots/enemyBases/knownEnemyRobots/knownEnemyBases/nearest`).
- `game/context.ts` — `GameContext { world, bus, resources, obstacles, rng, difficulty, config, commands, ai, intel }`; `createGameContext`. Globals (resources/obstacles/rng/intel) live here, NOT on entities. `intel: { player: TeamIntel; ai: TeamIntel }` is each side's shared detection state.
- `game/events.ts` + `eventBus.ts` — typed `EventBus<GameEvents>`; discrete events only (`entitySpawned/entityDestroyed/baseDestroyed/projectileFired/gameOver/sceneChanged`).
- `game/scene.ts` + `scenes/{menuScene,gameScene}.ts` — `Scene {enter/update/exit}` + `SceneManager`. `GameScene.enter` builds the world (bases/starters per difficulty + base settings); `update` runs the system pipeline then checks game-over.
- `game/engine.ts` — `GameEngine`: persistent `world` + `bus`; `tick(dt)` (skips when paused), `startMatch(config)`, `toMenu()`, `setPaused`, `enqueueCommand`, `get context`.
- Reused pure helpers: `pathfinding.ts` (`findPath`, `nearestFreeTile`), `obstacles.ts` (`generateObstacles`, `isBlockedGrid`, `hasLineOfSight`, `tileOf`, `tileCentre`), `economy.ts` (`buildCost/canAfford/spend/stepEconomy` — operate on `ResourcePool`), `tasks/taskDefinitions.ts` (`make*`, `scriptForTask(pos, task)` → a script carrying a `programId` + blackboard).

## Behaviour model (directive programs)

Robot behaviour is a **priority-ordered directive list** ("when → do"), not a single task. Types live in `types/tasks.ts` (`BehaviorCondition`, `BehaviorAction`, `Directive`, `Program`); the built-in programs (the JSON-describable scenarios) live in **`config/programs.ts`**, keyed by `TaskType` (the id the UI/settings pick — includes `Scout`, "Search & Detect"). `systems/task.ts` is the resolver: each tick it walks a robot's program and takes the **first move intent and first fire intent independently** (so a robot can `evade` while `attackAttacker` returns fire), then sets the goal + `targetId`. `combat.ts` fires at `targetId` whenever in range+LOS+cooldown — **decoupled from movement**. Being hit records `threat{attackerId,underFireLeft}` (drives the `underFire` condition, decayed in `task.ts`). Add a reaction = add a directive; add a program = add a `TaskType`/registry key.

**Build presets (auto-production series).** `config/buildPresets.ts` — `Record<BuildPresetType, BuildPreset>` (`{id, label, sequence: BuildOrder[]}`), `getBuildPreset(id)` (falls back to `Tracks`). A base's `production.autoBuildPreset` (id) + `autoBuildStep` (cycle cursor) drive `productionSystem`'s auto-refill: it queues `sequence[autoBuildStep % sequence.length]`, advancing the step only when the order is actually affordable (an unaffordable step just retries next tick, doesn't skip). A single-chassis auto-build is just a length-1 sequence. `BuildOrder.task` (see `types/entities.ts`) may be set per-step; extend the roster by adding a key, matching `config/programs.ts`'s "add a program by adding a key" pattern.

**Weapons (`gameConfig.robots.weapons[type]`).** Each entry is `{range,damage,cooldown,explosionRadius,sightMultiplier}`. `cannon`/`missiles` fire projectiles (`combat.ts`). `bomb` (kamikaze) has `explosionRadius > 0`: `combat.ts`'s `detonateBomb` deals `damage` to every enemy robot/base within the blast (AOE), spawns an oversized explosion (`spawnExplosion(pos, radius)` → `effect.maxRadius`), and sets its own `hp=0` (reap removes it). Its `range` (60) must exceed a base's half-footprint so it triggers at the base edge; the blast radius does the killing. `radar` has `sightMultiplier: 2` (scales the chassis `sight` in `spawnRobot`) and `range 0` → never engages, only spots. Add a weapon = add a `WeaponType` key + a `weapons`/`weaponCost` entry; damage-dealing paths key off `explosionRadius`/`range`, not the enum.

**No omniscience — enemies must be detected.** `enemyRobotsExist`/`enemyBasesExist`/`enemyRobotWithin` and the `attackNearest*` actions all read `targeting.ts`'s `knownEnemyRobots`/`knownEnemyBases`, not the raw (fully-omniscient) `enemyRobots`/`enemyBases`. "Known" is per-team, computed once per tick by `systems/vision.ts` (`visionSystem`) from each living robot's _and base's_ `sightRange` (robots and bases contribute vision equally), into `ctx.intel.{player,ai}`: `visibleRobotIds` is recomputed fresh every tick (an enemy robot drops out the instant no ally can see it — no memory, since it moves), `knownBaseIds` only grows (a base doesn't move, so discovery is permanent). Sight radii are config, not uniform: `gameConfig.robots.chassis[*].sight` per chassis type, `gameConfig.bases.sightRange` for bases. The `search` action (used as the `AttackBase`/`AttackRobots`/`Scout` fallback once nothing is known) roams to a random reachable tile via `ctx.rng` + `pathfinding.nearestFreeTile`, picking a new one on arrival. `guard` (Guard's action) is the same roam loop bounded to `gameConfig.behavior.guardPatrolRadius` around `blackboard.guardPos` (perimeter patrol, not standing still) — both share `blackboard.roamTarget` and a `roamOutcome` helper in `task.ts`.

## System pipeline order (GameScene.update)

`commands → economy → ai → production → vision → task → movement → separation → combat → reap → explosion → game-over`. Vision runs right before task (so directives act on this tick's fresh detection state); `separation` (pushes overlapping robots apart — see `systems/separation.ts`) runs right after movement so no two robots settle on the same coordinates; firing runs after movement/separation (final positions). Keep this order when adding systems.

## Contracts

- **Determinism:** fixed 30 Hz step + seeded `ctx.rng`. Don't use `Math.random` in systems — use `ctx.rng`.
- **Commands** are the only UI→core intent channel (`ctx.commands`, drained by `commandsSystem`). **EventBus** is engine→observers only (supplement; not for per-frame state).
- Navigation: set via `setGoal(ctx, entity, x, y)` / `clearGoal(entity)` (pathfinds around obstacles); never write `movement.destination` directly.
- When removing entities while iterating a query, snapshot first (`[...world.with(...)]`).

## Gotchas (tsconfig)

- `erasableSyntaxOnly`: **no TS `enum`** (const-map unions in `types/enums.ts`) and **no constructor parameter properties** (assign fields explicitly — see the scenes).
- `verbatimModuleSyntax`: `import type` for types. `noUnusedLocals/Parameters`. `as const` config → annotate reassigned fields (`: number`).
