---
name: dd-pixi
description: >-
  Knowledge for the Drone Directive PixiJS RENDERING + bridge layer (client/src/pixi/**).
  Use whenever a task changes how the world is drawn or how pointer/camera input
  works, or how the engine connects to the store: GameApp, the reactive-query
  WorldRenderer, entity views (Base/Robot/Projectile/Explosion/Obstacles/
  HealthBar), Camera, Grid, layers, sprite/asset loading, pointer input, or the
  audio/store bus adapters. Explains the ECS-driven renderer and the engine↔store
  bridge.
---

# Drone Directive — Pixi rendering + bridge (PixiJS v8, miniplex)

Owns the canvas and bridges the `GameEngine` to the store. **No React imports.** May import `client/src/engine/**`, the store (vanilla `useGameStore.getState()`), and — in `GameApp` only — `@drone-directive/net`.

## Files

- `GameApp.ts` — the boundary object React mounts (via `useGameApp`). Owns the `GameEngine`, `WorldRenderer`, camera, obstacle graphic. `init()`: `app.init` → `loadGameAssets` → build layers/camera → `new GameEngine()` → `WorldRenderer(layers, engine.world)` → `wireBus()` → pointer → loop. The loop `update` = `step(dt)`; `render` = `worldRenderer.sync(selectedIds, isVisibleToPlayer)`. `isVisibleToPlayer(e)` is the fog-of-war gate: player/neutral entities are always visible; an AI robot/base is only visible once `engine.context.intel.player` (see dd-engine's `TeamIntel`) has it in `visibleRobotIds`/`knownBaseIds`.
  - **step(dt):** apply store control flags (`restartRequested`→`engine.startMatch(config)`, `menuRequested`→`engine.toMenu()`, then `clearRequests()`); `engine.setPaused`; forward `drainCommands()`→`engine.enqueueCommand`; `engine.tick(dt)`; throttled `pushSnapshot`.
  - **wireBus():** `projectileFired`→`sfx.shot`, `entityDestroyed`→`sfx.explosion`+snapshot, `entitySpawned`→snapshot, `sceneChanged`→status + rebuild/clear obstacles + snapshot, `gameOver`→status won/lost.
  - **pushSnapshot():** projects `world.with('base'/'robot').entities` into store `BaseSnapshot`/`RobotSnapshot` DTOs + resources from `engine.context`.
- `render/WorldRenderer.ts` — **reactive queries**: `world.with(tag,'position')` per kind; `onEntityAdded`→create view, `onEntityRemoved`→destroy view; per-frame `sync(selectedIds, isVisible)` updates transforms/HP/selection/fog-of-war visibility. (miniplex Query narrows to `With<...>`; cast to `Query<Entity>`.)
- `render/{BaseView,RobotView,ProjectileView,ExplosionView}.ts` — take an `Entity`, read components (`position/heading/hp/maxHp/chassis/weaponType/owner/effect`). HP bars live here (per-frame), not React. `RobotView.update(robot, selected, visible)` / `BaseView.update(base, visible, selected)` toggle `container.visible` for fog of war — the view stays alive (not destroyed) while hidden, so it snaps back instantly once known again. Both draw a `palette.selection.ring` selection outline (circle / footprint rect); `RobotView` additionally shows a `palette.vision.spotted` highlight ring on enemy robots whenever `visible` is true (i.e. currently detected), and a `palette.blast.zone` radius ring on bomb-armed units. Only own-side views are `eventMode: 'static'` (enemy views stay pointer-transparent so right-clicks reach the stage → attack order): `RobotView` handles click-select + double-click "select all with this weapon"; `BaseView` handles double-click → `setBuildDialogOpen(true)` only — *selecting* a base is the stage handler's job in `input/pointer.ts`, because a click here bubbles anyway and would be undone by the stage's deselect. Both share `input/doubleClick.ts`'s `DOUBLE_CLICK_MS` and let single clicks bubble to the stage.
- `render/RallyView.ts` — GameApp-owned (not ECS-bound) `Graphics` in the `overlay` layer, drawing the **local side's** rally flags plus a leader line to the base that owns each. Both peers hold every base's `production.rally`, so this filter is what keeps the opponent's gathering point off screen. Redraws only when a marker moves.
- `render/ObstaclesView.ts` — `createObstaclesGraphic(terrain)` from `engine.context.terrain` (rebuilt per match on `sceneChanged: game`); one tile sprite per blocked cell, picked from `terrainSprites` by `TerrainKind` (mountain/crater), flat Graphics fill as fallback.
- `assets.ts` + `../config/sprites.ts` — `loadGameAssets`, `getRobotTexture(chassis)` (cached, optional crop frame) → placeholder fallback.
- `audio/sfx.ts` — WebAudio SFX, driven by the bus (not by the renderer).
- `Camera.ts`, `Grid.ts`, `layers.ts` (ground→units→projectiles→fx→overlay), `GameLoop.ts` (fixed step), `input/pointer.ts` (left-drag marquee with Shift-add; plain left click selects your own base under the cursor, else deselects; right click enqueues `SetRallyPoint` when a base is selected — on the base itself it clears — otherwise `AttackTarget`/`MoveRobots`. Orders go through `store.enqueueCommand`, never direct entity mutation, so both peers apply them on the same tick. No mouse panning: the camera follows the observer drone, flown with WASD/arrows).
- **Networking is not in this layer.** It lives in the `@drone-directive/net` workspace (transport + wire codec + validation) — see `net/README.md` and `.docs/multiplayer.md`. `GameApp` is the only file here that touches it: it builds a `LockstepSession` with `client/src/config/multiplayer.ts`'s `lockstepConfig`, and calls `worldHash` (now `client/src/engine/worldHash.ts`) for the desync probe. Don't add socket, codec, or schema code under `pixi/`.

## Rules & gotchas

- **Snapshot throttling:** never push per-frame HP to the store (React re-render storm). Push on bus spawn/destroy + every `gameConfig.hud.snapshotEveryTicks`. Live HP shows via Pixi views reading the ECS world each frame.
- **Teardown:** unsubscribe bus + reactive queries, destroy views/graphics, on `useGameApp` unmount + `GameApp.destroy` (idempotent; StrictMode double-mounts).
- The persistent ECS `world` survives restarts (entities cleared/respawned) so the renderer subscribes once.
- **Online input filters must be symmetric.** `GameApp.stepOnline` screens both sides' batches with `isCommandFrom`, and `net` does the same with its schemas — a filter only one side applies is a desync. See **dd-net** before touching anything online.
- tsconfig: prefer const-map unions over `enum` and explicit fields over ctor param props; `import type`; no unused symbols.
