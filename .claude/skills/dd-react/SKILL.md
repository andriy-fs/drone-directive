---
name: dd-react
description: >-
  Knowledge for the Drone Directive REACT UI + STATE layer (client/src/ui/** and
  client/src/store/**). Use whenever a task changes the HUD, screens/menus/overlays,
  panels, buttons, the Zustand store, snapshot DTOs, selectors, hotkeys, or how
  UI actions reach the game. Explains the store contract, the command queue,
  control-flags→engine, and snapshot-driven render.
---

# Drone Directive — React UI + state layer

React renders only HUD/screens/overlays. **Never import Pixi objects or ECS entities.** Talk to the **Zustand store** only. All React lives under `client/src/ui/**`; the store stays at `client/src/store/**` (the Pixi bridge reads it too).

## UI primitives

- Use `@headlessui/react` for the shared base components in `client/src/ui`: `Button` for button-like actions, `Switch` for binary toggles, and `Dialog`/`DialogPanel`/`DialogTitle` for modal overlays.
- Prefer replacing raw native `<button>` / custom modal markup with Headless UI primitives instead of adding more bespoke HTML wrappers in `client/src/ui`.
- Use `lucide-react` for icons in `client/src/ui`. Replace emoji or text glyphs with the matching SVG icon from this library whenever a control or status needs an icon.
- Keep the styling layer in `App.css`, but the accessibility, interaction behavior, and iconography should come from Headless UI + `lucide-react`.

## Layout (`client/src/ui/`)

- `App.tsx` / `App.css` — layout: HUD sidebar + `<GameCanvas/>` + `<MainMenu/>`/`<GameOverModal/>` overlays; wires hotkeys.
- `GameCanvas.tsx` + `hooks/useGameApp.ts` — the ONLY React↔Pixi seam: a host `<div ref>` that mounts a `GameApp` (StrictMode-safe async init + idempotent destroy).
- `hud/` — the in-game overlay: `StatusPanel`, `PauseButton`, `SoundToggle`, `ProgrammingPanel`, `TaskPicker` (one `AssignTask` per selected id), `ChassisPicker`, `WeaponPicker`, and `BuildRobotModal` (in-game dialog: build once / auto-build). Shared pickers live here because both the panel and the dialog use them.
- `screens/` — `MainMenu` (difficulty + a gear button opening `BaseSetupModal`), `BaseSetupModal` (auto-produce + robot program; grows with more base settings), `OnlinePanel`, `GameOverModal`.
- **At most one Headless UI `Dialog` may be mounted at a time — this is load-bearing, and there is no test guarding it.** `MainMenu` is therefore a plain panel, not a `Dialog` (it can't be closed, so it gained nothing from being one), and its overlays hang off a single `modal` slot rather than one boolean per modal. Two dialogs at once means one is *nested* in the other, and React runs a child's effects before its parent's: mounting both in the same commit (returning to the menu from a finished online match, where `online.status` re-opens the lobby by itself) registers them in Headless UI's stack **inverted**, so the parent counts as top layer and marks the child `inert` — a modal that is painted, unclickable, and sitting over a still-clickable menu. Adding a second independently-gated modal here reintroduces exactly that.
- `common/` — `Button` (Headless UI-backed), `Bar`.
- `hooks/` — `useGameApp`, `usePauseHotkey` (Space/P/Esc), `useSelectAllHotkey` (Ctrl/Cmd+A).
- `features/<name>/` — the one cut by **subject** rather than by kind, for a concern whose pure logic, hook and component are only ever used by each other: putting them in three folders would spread one idea across the tree for no reader's benefit. `features/device/` is the screen-size gate — `deviceFit.ts` (pure `(w, h) → verdict`, tested), `useDeviceFit.ts` (the live subscription), `DeviceNotice.tsx` (rotate screen / soft too-small banner). File names repeat the folder name, as in `client/src/chat/`. **Reach for `hud/` or `screens/` first** — a component that belongs to the in-match overlay or is one of the menu's screens goes there, whatever else it needs; `features/` is for the case where the non-component half is the bulk of it.

## Store (`client/src/store/`)

- **Four files, one store.** `types.ts` is the contract — the snapshot DTOs, `OnlineState`/`PendingOnline`/`ChatState`, and `GameState` as `GameStateFields & GameActions` (what it holds / what it does); `enums.ts` is the enum-like values that survive to runtime (`GameStatus`, `OnlineStatus`, `OnlineLink`, `OnlineRequest`, `DroneMode` — const map + same-named union, per `types/src/enums.ts`); `initialState.ts` is the starting values, annotated `GameStateFields`; `gameStore.ts` is only the actions. Import values from `store/enums`, shapes from `store/types`, the hook from `store/gameStore`. **Adding a field to the store means editing `GameStateFields` and `initialState` together** — the annotation makes the second one a compile error, pointing at the object rather than at `create()`. Never compare a status to a bare string: `status === GameStatus.Playing`, not `=== 'playing'`.
- `gameStore.ts` — single store. Holds `status`, HUD snapshot DTOs (`bases: BaseSnapshot[]`, `robots: RobotSnapshot[]`, `resources`), `selectedRobotIds`, `selectedBaseId` (mutually exclusive with the robot selection — the store actions enforce it), `commands`, one-shot control flags (`restartRequested`, `menuRequested`, `paused`), shared UI state the canvas also drives (`buildDialogOpen` — the Build &amp; Program dialog, opened by `StatusPanel`'s button or a double-click on your base), and persistent settings (`difficulty`, `baseAutoBuild`, `baseDefaultTask`). Snapshot DTOs are flat projections of ECS entities (`RobotSnapshot {id,owner,chassis,weapon,task}`, `BaseSnapshot {id,owner,hp,maxHp,queueLength,buildProgress,autoBuild,defaultTask,rally,shield}`, where `shield: BaseShieldSnapshot {active,hp,maxHp,secondsLeft,spent,threatNear}` drives the Command section's dome tile — `threatNear` is computed engine-side from that side's intel and is **always false for a base that isn't the local side's**, since it is private knowledge the store has no business holding) — NOT the engine entities.
- `selectors.ts` — `selectStatus/Bases/Robots/Resources/SelectedIds/PlayerBase`. Subscribe to the smallest slice.

## Contracts

- **UI → game = commands or flags.** Player intents → `enqueueCommand({...})` (the bridge forwards to `engine.enqueueCommand`, drained by the engine's command system). Meta actions set flags the bridge maps to the engine: `requestRestart`→`engine.startMatch(settings)`, `requestMenu`→`engine.toMenu()`, `paused`→`engine.setPaused` (online it is the other way round: `togglePause` only raises `pauseTogglePending`, the bridge puts it on the wire, and `paused` comes back once both simulations stop on the agreed tick). Selection (`selectRobots/toggleRobot/clearSelection`) is UI state the renderer reads.
- **Game → UI = throttled snapshots + status.** The bridge (GameApp) projects the ECS world into the snapshot DTOs (~5×/s or on spawn/destroy) and sets `status` from bus `sceneChanged`/`gameOver`. Treat snapshots as read-only, slightly-lagging view data (live HP is drawn in Pixi).
- The engine/world lives outside the store; that's why restart/menu/settings go through flags + `startMatch(config)`.

## Gotchas

- The `status` values (`menu/playing/won/lost`) are driven by engine scene events via the bridge — don't set them speculatively in the UI.
- A just-spawned unit appears on the next snapshot (spawn triggers one).
- When adding or changing buttons, switches, or modals under `client/src/ui`, update the Headless UI-backed primitive rather than introducing another hand-rolled HTML control.
- If the UI needs an icon, choose the corresponding `lucide-react` component instead of Unicode emoji or custom CSS glyphs.
- Enums and value types (`TaskType`, `Owner`, `Command`, `BuildOrder`…) come from the shared **`@drone-directive/types`** workspace, imported by subpath (`@drone-directive/types/enums`) — not from a path under `client/src/`.
- tsconfig: `verbatimModuleSyntax` → `import type`; no unused symbols. React 19 + `react-jsx` (no `React` import needed).
