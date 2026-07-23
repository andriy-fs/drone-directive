---
name: nether-react
description: >-
  Knowledge for the Drone Directive REACT UI + STATE layer (src/ui/** and
  src/store/**). Use whenever a task changes the HUD, screens/menus/overlays,
  panels, buttons, the Zustand store, snapshot DTOs, selectors, hotkeys, or how
  UI actions reach the game. Explains the store contract, the command queue,
  control-flags→engine, and snapshot-driven render.
---

# Drone Directive — React UI + state layer

React renders only HUD/screens/overlays. **Never import Pixi objects or ECS entities.** Talk to the **Zustand store** only. All React lives under `src/ui/**`; the store stays at `src/store/**` (the Pixi bridge reads it too).

## UI primitives

- Use `@headlessui/react` for the shared base components in `src/ui`: `Button` for button-like actions, `Switch` for binary toggles, and `Dialog`/`DialogPanel`/`DialogTitle` for modal overlays.
- Prefer replacing raw native `<button>` / custom modal markup with Headless UI primitives instead of adding more bespoke HTML wrappers in `src/ui`.
- Use `lucide-react` for icons in `src/ui`. Replace emoji or text glyphs with the matching SVG icon from this library whenever a control or status needs an icon.
- Keep the styling layer in `App.css`, but the accessibility, interaction behavior, and iconography should come from Headless UI + `lucide-react`.

## Layout (`src/ui/`)

- `App.tsx` / `App.css` — layout: HUD sidebar + `<GameCanvas/>` + `<MainMenu/>`/`<GameOverModal/>` overlays; wires hotkeys.
- `GameCanvas.tsx` + `hooks/useGameApp.ts` — the ONLY React↔Pixi seam: a host `<div ref>` that mounts a `GameApp` (StrictMode-safe async init + idempotent destroy).
- `hud/` — the in-game overlay: `StatusPanel`, `PauseButton`, `SoundToggle`, `ProgrammingPanel`, `TaskPicker` (one `AssignTask` per selected id), `ChassisPicker`, `WeaponPicker`, and `BuildRobotModal` (in-game dialog: build once / auto-build). Shared pickers live here because both the panel and the dialog use them.
- `screens/` — `MainMenu` (difficulty + a gear button opening `BaseSetupModal`), `BaseSetupModal` (auto-produce + robot program; grows with more base settings), `GameOverModal`.
- `common/` — `Button` (Headless UI-backed), `Bar`.
- `hooks/` — `useGameApp`, `usePauseHotkey` (Space/P/Esc), `useSelectAllHotkey` (Ctrl/Cmd+A).

## Store (`src/store/`)

- `gameStore.ts` — single store. Holds `status`, HUD snapshot DTOs (`bases: BaseSnapshot[]`, `robots: RobotSnapshot[]`, `resources`), `selectedRobotIds`, `commands`, one-shot control flags (`restartRequested`, `menuRequested`, `paused`), and persistent settings (`difficulty`, `baseAutoBuild`, `baseDefaultTask`). Snapshot DTOs are flat projections of ECS entities (`RobotSnapshot {id,owner,chassis,weapon,task}`, `BaseSnapshot {id,owner,hp,maxHp,queueLength,buildProgress,autoBuild}`) — NOT the engine entities.
- `selectors.ts` — `selectStatus/Bases/Robots/Resources/SelectedIds/PlayerBase`. Subscribe to the smallest slice.

## Contracts

- **UI → game = commands or flags.** Player intents → `enqueueCommand({...})` (the bridge forwards to `engine.enqueueCommand`, drained by the engine's command system). Meta actions set flags the bridge maps to the engine: `requestRestart`→`engine.startMatch(settings)`, `requestMenu`→`engine.toMenu()`, `paused`→`engine.setPaused`. Selection (`selectRobots/toggleRobot/clearSelection`) is UI state the renderer reads.
- **Game → UI = throttled snapshots + status.** The bridge (GameApp) projects the ECS world into the snapshot DTOs (~5×/s or on spawn/destroy) and sets `status` from bus `sceneChanged`/`gameOver`. Treat snapshots as read-only, slightly-lagging view data (live HP is drawn in Pixi).
- The engine/world lives outside the store; that's why restart/menu/settings go through flags + `startMatch(config)`.

## Gotchas

- The `status` values (`menu/playing/won/lost`) are driven by engine scene events via the bridge — don't set them speculatively in the UI.
- A just-spawned unit appears on the next snapshot (spawn triggers one).
- When adding or changing buttons, switches, or modals under `src/ui`, update the Headless UI-backed primitive rather than introducing another hand-rolled HTML control.
- If the UI needs an icon, choose the corresponding `lucide-react` component instead of Unicode emoji or custom CSS glyphs.
- tsconfig: `verbatimModuleSyntax` → `import type`; no unused symbols. React 19 + `react-jsx` (no `React` import needed).
