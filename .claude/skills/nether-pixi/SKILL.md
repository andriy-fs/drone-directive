---
name: nether-pixi
description: >-
  Knowledge for the Drone Directive PixiJS RENDERING + bridge layer (src/pixi/**).
  Use whenever a task changes how the world is drawn or how pointer/camera input
  works, or how the engine connects to the store: GameApp, the reactive-query
  WorldRenderer, entity views (Base/Robot/Projectile/Explosion/Obstacles/
  HealthBar), Camera, Grid, layers, sprite/asset loading, pointer input, or the
  audio/store bus adapters. Explains the ECS-driven renderer and the engine↔store
  bridge.
---

# Drone Directive — Pixi rendering + bridge (PixiJS v8, miniplex)

Owns the canvas and bridges the `GameEngine` to the store. **No React imports.** May import `src/engine/**` and the store (vanilla `useGameStore.getState()`).

## Files

- `GameApp.ts` — the boundary object React mounts (via `useGameApp`). Owns the `GameEngine`, `WorldRenderer`, camera, obstacle graphic. `init()`: `app.init` → `loadGameAssets` → build layers/camera → `new GameEngine()` → `WorldRenderer(layers, engine.world)` → `wireBus()` → pointer → loop. The loop `update` = `step(dt)`; `render` = `worldRenderer.sync(selectedIds, isVisibleToPlayer)`. `isVisibleToPlayer(e)` is the fog-of-war gate: player/neutral entities are always visible; an AI robot/base is only visible once `engine.context.intel.player` (see nether-engine's `TeamIntel`) has it in `visibleRobotIds`/`knownBaseIds`.
  - **step(dt):** apply store control flags (`restartRequested`→`engine.startMatch(config)`, `menuRequested`→`engine.toMenu()`, then `clearRequests()`); `engine.setPaused`; forward `drainCommands()`→`engine.enqueueCommand`; `engine.tick(dt)`; throttled `pushSnapshot`.
  - **wireBus():** `projectileFired`→`sfx.shot`, `entityDestroyed`→`sfx.explosion`+snapshot, `entitySpawned`→snapshot, `sceneChanged`→status + rebuild/clear obstacles + snapshot, `gameOver`→status won/lost.
  - **pushSnapshot():** projects `world.with('base'/'robot').entities` into store `BaseSnapshot`/`RobotSnapshot` DTOs + resources from `engine.context`.
- `render/WorldRenderer.ts` — **reactive queries**: `world.with(tag,'position')` per kind; `onEntityAdded`→create view, `onEntityRemoved`→destroy view; per-frame `sync(selectedIds, isVisible)` updates transforms/HP/selection/fog-of-war visibility. (miniplex Query narrows to `With<...>`; cast to `Query<Entity>`.)
- `render/{BaseView,RobotView,ProjectileView,ExplosionView}.ts` — take an `Entity`, read components (`position/heading/hp/maxHp/chassis/weaponType/owner/effect`). HP bars live here (per-frame), not React. `RobotView.update(robot, selected, visible)` / `BaseView.update(base, visible)` toggle `container.visible` for fog of war — the view stays alive (not destroyed) while hidden, so it snaps back instantly once known again. Both also draw a static translucent `sightRange`-radius ring (`palette.vision.zone`) at construction, shown only for the player's own units (an enemy's sight range stays hidden intel); `RobotView` additionally shows a `palette.vision.spotted` highlight ring on enemy robots whenever `visible` is true (i.e. currently detected).
- `render/ObstaclesView.ts` — `createObstaclesGraphic(obstacles)` from `engine.context.obstacles` (rebuilt per match on `sceneChanged: game`).
- `assets.ts` + `../config/sprites.ts` — `loadGameAssets`, `getRobotTexture(chassis)` (cached, optional crop frame) → placeholder fallback.
- `audio/sfx.ts` — WebAudio SFX, driven by the bus (not by the renderer).
- `Camera.ts`, `Grid.ts`, `layers.ts` (ground→units→projectiles→fx→overlay), `GameLoop.ts` (fixed step), `input/pointer.ts` (left-drag marquee, Shift add, middle-drag pan, right-click formation move via `engine.context` + `setGoal`).

## Rules & gotchas

- **Snapshot throttling:** never push per-frame HP to the store (React re-render storm). Push on bus spawn/destroy + every `gameConfig.hud.snapshotEveryTicks`. Live HP shows via Pixi views reading the ECS world each frame.
- **Teardown:** unsubscribe bus + reactive queries, destroy views/graphics, on `useGameApp` unmount + `GameApp.destroy` (idempotent; StrictMode double-mounts).
- The persistent ECS `world` survives restarts (entities cleared/respawned) so the renderer subscribes once.
- tsconfig: no `enum` / no ctor param props; `import type`; no unused symbols.
