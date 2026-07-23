# Drone Directive (Web) — Architecture & Implementation Roadmap

> Browser-based top-down RTS built with **React 19 + PixiJS 8 + TypeScript + Vite + Zustand**. This roadmap is written for incremental execution by an AI agent — build phase by phase, verifying each before moving on.

> **⚠️ Architecture update (supersedes parts of §0–§8 below).** After the initial
> build, the game core was rearchitected to **Scene-based + ECS (miniplex)** with a
> typed **EventBus** as an engine→observers supplement. The "mutable `World` struct
>
> - systems-as-functions" described below is now **ECS entities/components + systems
>   over a miniplex world**, orchestrated by scenes and a `GameEngine` facade; the
>   Zustand store remains the render-state channel (throttled snapshots) and the
>   command queue remains the UI→core intent channel. The gameplay/feature intent of
>   each phase still holds — only the core's shape changed. **For current structure and
>   rules, read `CLAUDE.md` and `.claude/skills/{nether-engine,nether-pixi,nether-react}`**,
>   which are authoritative over the sections below.

## 0. Guiding Principles

1. **Pixi owns the game world; React owns the UI (HUD, menus, modals).** They never render into each other's tree.
2. **One source of truth: the Zustand store.** React reads/writes it reactively; the Pixi game loop reads it every frame and pushes results back.
3. **React → Pixi is imperative-by-intent:** button clicks mutate store state (e.g. "selected robot", "pending task") or push onto a **command queue** that the game loop drains. Pixi never imports React components.
4. **Pixi → React is reactive:** the loop writes snapshots (HP, unit lists, resources, win/lose) into the store; React re-renders from subscriptions.
5. **Fixed-timestep simulation** for deterministic combat/AI, decoupled from render frame rate.
6. **Placeholder-first:** every entity is a colored `Graphics` shape until art exists. Types and logic are built so swapping in `Sprite`/`Texture` later is trivial.

### Why manual Pixi mount (not `@pixi/react`)

`@pixi/react` reconciles a React tree into the Pixi scene graph, which adds a render-reconciliation layer between us and the ticker — awkward for a tight game loop with hundreds of transient objects (projectiles, explosions) and per-frame mutation. Manual mounting gives us: direct `Application` lifecycle control, a single authoritative `ticker` callback, freedom to pool/recycle display objects, and a clean React boundary (React only ever sees a `<div ref>`). We keep `pixi.js` as the only Pixi dependency.

---

## 1. Project Structure

```
src/
  main.tsx                 # React entry (unchanged concept)
  App.tsx                  # Top-level layout: <GameCanvas/> + HUD panels + modals
  index.css / App.css      # Global + layout styles (replace Vite demo CSS)

  config/
    gameConfig.ts          # Tunables: grid size, tile px, speeds, HP, costs, timers
    palette.ts             # Placeholder colors per chassis/weapon/owner

  types/
    index.ts               # Re-exports
    entities.ts            # Base, Robot, Projectile, Explosion interfaces
    enums.ts               # Union types + const maps: ChassisType, WeaponType, Owner, TaskType, RobotState
    commands.ts            # Command queue types (React → engine intents)
    tasks.ts               # RobotScript / task-definition types

  store/
    gameStore.ts           # Zustand store: entities snapshot, UI state, command queue, actions
    selectors.ts           # Memoized/derived selectors (playerRobots, aiRobots, selectedRobot…)

  pixi/
    GameApp.ts             # Wraps PIXI.Application: init(), destroy(), attach(container)
    GameLoop.ts            # Fixed-timestep update() + interpolated render()
    Camera.ts              # World-space pan/zoom via a root PIXI.Container
    Grid.ts                # Draws the top-down battlefield grid/background
    coords.ts              # tile<->world<->screen conversion helpers
    layers.ts              # Named containers (ground, units, projectiles, fx, overlay)
    render/
      BaseView.ts          # Graphics for a Base (+ HP bar overlay)
      RobotView.ts         # Graphics for a Robot (chassis shape + weapon marker + HP bar)
      ProjectileView.ts    # Graphics for a projectile
      ExplosionView.ts     # Placeholder explosion animation
      CursorView.ts        # Crosshair / selection ring
    input/
      pointer.ts           # Maps Pixi pointer events -> screen -> tile -> store/commands

  engine/                  # Pure-ish simulation logic (no Pixi, no React imports)
    world.ts               # World state container the loop mutates each tick
    movement.ts            # Path/point-to-point movement, steering
    combat.ts              # Targeting, collision, damage, destruction
    tasks/
      taskRunner.ts        # Executes a robot's script each tick (FSM)
      taskDefinitions.ts   # Guard / AttackBase / AttackRobots -> script factories
    ai/
      aiManager.ts         # Enemy spawn timers, strategy, param randomization
    spawn.ts               # Build/produce robots from a base queue
    factory.ts             # createBase(), createRobot(), createProjectile()

  hooks/
    useGameApp.ts          # Mounts/destroys GameApp against a container ref
    useGameSync.ts         # Bridges store <-> engine snapshot each frame (if needed)
    useResizeObserver.ts   # Canvas sizing

  components/
    GameCanvas.tsx         # <div ref> host for Pixi; owns useGameApp
    hud/
      StatusPanel.tsx      # Resources + production queue
      MiniStatus.tsx       # (optional) counts of units/bases
    programming/
      ProgrammingPanel.tsx # Select robot from queue -> open builder
      ChassisPicker.tsx    # 3 chassis choices
      WeaponPicker.tsx     # 2-3 weapon choices
      TaskPicker.tsx       # Guard / Attack base / Attack robots
    modals/
      BuildRobotModal.tsx  # Chassis+Weapon build flow
      GameOverModal.tsx    # Victory / Defeat
    common/
      Panel.tsx, Button.tsx, Bar.tsx

  utils/
    id.ts                  # unique id generator
    math.ts                # clamp, lerp, distance, vector helpers
    rng.ts                 # seedable random for AI
    pool.ts                # object pool for projectiles/explosions
```

**Separation rule of thumb:** anything in `engine/` and `pixi/` must be usable/testable without React. Anything in `components/` must not import Pixi display objects directly — it talks to the store only.

---

## 2. Environment Setup (Phase 0)

Already scaffolded (Vite + React 19 + TS + pixi.js@8 + zustand). Remaining setup:

1. **Strip the Vite demo:** replace `App.tsx`, gut demo CSS, remove demo assets/README boilerplate.
2. **Layout & canvas sizing.** App shell = CSS grid: a full-height **left/bottom HUD** region (React) + a flexible **game viewport** region hosting `<GameCanvas/>`. Canvas fills its region; `ResizeObserver` (or Pixi's `resizeTo`) keeps the renderer sized to the container. Decision: **fixed game viewport with side/bottom panels** (closer to the original's bordered playfield) rather than fullscreen canvas with floating overlays.
3. **Config note on tsconfig:** `erasableSyntaxOnly` is enabled → **do not use TS `enum` or constructor parameter properties.** Use `const X = {...} as const` + `type X = typeof X[keyof typeof X]` for enums, and explicit field assignment in constructors.
4. No new dependencies required for the core. (Optional later: `howler` for audio, `vitest` for tests.)

`GameCanvas.tsx` skeleton:

```ts
export function GameCanvas(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  useGameApp(hostRef);           // mounts PIXI.Application into hostRef, destroys on unmount
  return <div ref={hostRef} className="game-canvas" />;
}
```

`useGameApp` signature:

```ts
function useGameApp(hostRef: RefObject<HTMLDivElement>): void;
// - creates GameApp once, awaits app.init({ resizeTo: host, antialias, background })
// - attaches canvas, starts GameLoop, wires pointer input
// - StrictMode-safe: guard against double-init; full teardown in cleanup
```

---

## 3. Game Engine (PixiJS)

### 3.1 GameApp (`pixi/GameApp.ts`)

```ts
class GameApp {
  app: PIXI.Application;
  camera: Camera;
  layers: Layers;
  loop: GameLoop;
  async init(host: HTMLElement): Promise<void>;
  destroy(): void;
}
```

Owns the `PIXI.Application`, the `Camera` root container, and named `layers` (ground → units → projectiles → fx → overlay). Exposes nothing to React except through the store.

### 3.2 GameLoop (`pixi/GameLoop.ts`) — fixed timestep

```ts
class GameLoop {
  constructor(world: World, layers: Layers, store: GameStoreApi);
  start(ticker: PIXI.Ticker): void;
  private update(dt: number): void; // fixed-step simulation
  private render(alpha: number): void; // interpolate views toward world state
}
```

- Drive from `app.ticker`. Accumulate elapsed time; run `update(FIXED_DT)` (e.g. 1/30s) in a while-loop; call `render(alpha)` once with interpolation factor.
- `update` order each tick: **drain command queue → AI manager → task runner (per robot) → movement → combat/collision → spawning/production → cleanup destroyed → write snapshot to store.**
- Writing to the store every tick is expensive; **throttle store snapshots** (e.g. every N ticks, or only push HUD-relevant aggregates: counts, resources, selected-unit HP, game-over). Per-entity visual updates stay inside Pixi views, not React.

### 3.3 Coordinate system (`pixi/coords.ts`) — top-down grid

- World is a **grid of tiles** (`GRID_W × GRID_H`, `TILE_PX` pixels each). Robots move in continuous world coordinates but reason about tiles for targets/pathing.
- Helpers: `tileToWorld(tx,ty)`, `worldToTile(wx,wy)`, `screenToWorld(sx,sy, camera)`, `worldToScreen(...)`.
- `Camera.ts`: a root `PIXI.Container` that all world layers live under; supports pan (drag / edge scroll) and clamp to world bounds; optional zoom.

### 3.4 Assets / placeholders

- No texture loading initially. `render/*.ts` draw `PIXI.Graphics`:
  - **Owner** → base tint (player = blue, AI = red).
  - **Chassis** → body shape: tracks = square, wheels = rounded-rect, legs = hexagon/triangle.
  - **Weapon** → small marker on the body: cannon = short bar, missiles = dots, none = plain.
- `config/palette.ts` centralizes all colors. Later, swap each `draw()` for a `PIXI.Sprite` with an `Assets.load` texture — the view class interface stays identical.

---

## 4. Game Entities (types + factories)

`types/enums.ts` (enum-free per tsconfig):

```ts
export const ChassisType = {
  Tracks: "tracks",
  Wheels: "wheels",
  Legs: "legs",
} as const;
export type ChassisType = (typeof ChassisType)[keyof typeof ChassisType];

export const WeaponType = {
  None: "none",
  Cannon: "cannon",
  Missiles: "missiles",
} as const;
export type WeaponType = (typeof WeaponType)[keyof typeof WeaponType];

export const Owner = { Player: "player", AI: "ai" } as const;
export type Owner = (typeof Owner)[keyof typeof Owner];

export const TaskType = {
  Guard: "guard",
  AttackBase: "attackBase",
  AttackRobots: "attackRobots",
  Idle: "idle",
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const RobotState = {
  Idle: "idle",
  Moving: "moving",
  Attacking: "attacking",
  Guarding: "guarding",
  Dead: "dead",
} as const;
export type RobotState = (typeof RobotState)[keyof typeof RobotState];
```

`types/entities.ts`:

```ts
interface Vec2 {
  x: number;
  y: number;
}

interface Base {
  id: string;
  owner: Owner;
  pos: Vec2; // world coords (grid-aligned)
  hp: number;
  maxHp: number;
  productionQueue: BuildOrder[];
  buildProgress: number; // 0..1 of current order
}

interface BuildOrder {
  chassis: ChassisType;
  weapon: WeaponType;
}

interface Robot {
  id: string;
  owner: Owner;
  pos: Vec2;
  heading: number; // radians
  chassis: ChassisType;
  weapon: WeaponType;
  hp: number;
  maxHp: number;
  speed: number;
  range: number;
  damage: number;
  fireCooldown: number;
  cooldownLeft: number;
  state: RobotState;
  script: RobotScript; // current task program
  targetId?: string;
  movePath?: Vec2[];
  destination?: Vec2;
}

interface Projectile {
  id: string;
  owner: Owner;
  pos: Vec2;
  vel: Vec2;
  damage: number;
  targetId?: string;
  ttl: number;
}

interface Explosion {
  id: string;
  pos: Vec2;
  age: number;
  duration: number;
}
```

`engine/factory.ts`: `createBase(owner,pos)`, `createRobot(owner,pos,chassis,weapon)`, `createProjectile(owner,from,target)`. Derived stats (speed/hp/range/damage) come from `config/gameConfig.ts` lookup tables keyed by chassis+weapon.

**Cursor/Crosshair:** not an entity in the world state — it's UI/input. `pixi/render/CursorView.ts` + `pixi/input/pointer.ts` translate pointer to tile, drive selection highlight and target-picking; results go into the store (`selectedRobotId`, or a `Command`).

---

## 5. Robot Programming Logic (task → script)

Mirrors the original: pick a produced robot, choose chassis + weapon, then assign a behavior. Here chassis/weapon are chosen at **build time** (production queue) and the **task** is assigned to the finished robot.

`types/tasks.ts`:

```ts
interface RobotScript {
  task: TaskType;
  params: {
    guardPos?: Vec2; // for Guard
    targetBaseId?: string; // for AttackBase
    // AttackRobots needs no fixed target; it acquires nearest enemy
  };
}
```

`engine/tasks/taskDefinitions.ts` — factories turning a UI choice into a script:

```ts
function makeGuard(pos: Vec2): RobotScript;
function makeAttackBase(baseId: string): RobotScript;
function makeAttackRobots(): RobotScript;
```

`engine/tasks/taskRunner.ts` — per-tick FSM executing a robot's script:

```ts
function runTask(robot: Robot, world: World, dt: number): void;
// Guard:       stay near guardPos; if enemy enters range -> engage, then return.
// AttackBase:  move toward target base; when in range -> fire until destroyed; then Idle.
// AttackRobots: acquire nearest enemy robot -> chase into range -> fire; re-acquire on death.
// Sets robot.state, robot.destination/targetId; delegates motion to movement.ts and firing to combat.ts.
```

**UI flow (React):** `ProgrammingPanel` lists idle player robots (from store) → user selects one (`store.selectRobot(id)`) → `TaskPicker` shows the 3 tasks; for `AttackBase` the user then clicks an enemy base on the canvas (pointer input writes the picked base id). Confirming dispatches an `AssignTask` command onto the queue; the loop applies it via `taskDefinitions`.

---

## 6. Enemy AI (`engine/ai/aiManager.ts`)

```ts
class AIManager {
  update(world: World, dt: number): void;
}
```

- **Spawn timers:** accumulate time; when `spawnTimer >= interval` and resources/queue allow, enqueue a `BuildOrder` on the AI base with **randomized** chassis+weapon (`utils/rng.ts`). Interval shrinks slightly over time for escalating pressure.
- **Strategy (staged, simple):**
  1. **Defense first** — until the AI has ≥ N robots, assign new ones `Guard` around its base.
  2. **Attack bases** — once the guard quota is met, assign a fraction `AttackBase` targeting the player's nearest base.
  3. **Attack robots** — if player units threaten the AI base, assign `AttackRobots`.
- Keep it stateless-ish: recompute assignments from world counts each decision tick rather than storing complex plans.

---

## 7. Combat System (`engine/combat.ts`)

```ts
function acquireTarget(robot: Robot, world: World): string | undefined; // nearest enemy in/near range
function tryFire(robot: Robot, world: World): Projectile | undefined; // respects cooldown + range
function stepProjectiles(world: World, dt: number): void; // move, check hits, apply damage
function applyDamage(target: Base | Robot, amount: number, world: World): void;
function reapDead(world: World): void; // remove hp<=0, spawn Explosion
```

- **Collision:** circle-vs-circle (distance ≤ sum of radii) for projectile↔unit — simpler and adequate for top-down. AABB available in `utils/math.ts` if needed for bases.
- **Damage:** `damage - (armor?)`; chassis can grant HP differences (legs tanky/slow, wheels fast/fragile) via `gameConfig`.
- **Destruction:** `hp <= 0` → mark `RobotState.Dead` / base destroyed → `reapDead` removes it, creates an `Explosion`, and if it's a **base**, checks win/lose.
- **Explosion placeholder:** `ExplosionView` grows/fades a circle over `duration`, then removed. Use `utils/pool.ts` for projectiles and explosions to avoid GC churn.

---

## 8. State Management (Zustand — `store/gameStore.ts`)

Recommended: **Zustand** (chosen). Single store; game loop uses `getState()/setState` outside React, components use the hook.

```ts
interface GameState {
  // snapshots the loop writes (HUD-facing)
  status: "menu" | "playing" | "won" | "lost";
  resources: Record<Owner, number>;
  bases: Base[];
  playerRobots: Robot[];
  aiRobots: Robot[];

  // UI state (React-owned)
  selectedRobotId?: string;
  pendingTask?: TaskType; // task mid-assignment awaiting a target
  buildDraft?: Partial<BuildOrder>; // chassis/weapon being chosen in modal

  // command queue (React -> engine)
  commands: Command[];

  // actions
  selectRobot(id?: string): void;
  setPendingTask(t?: TaskType): void;
  enqueueCommand(c: Command): void;
  drainCommands(): Command[]; // called by loop each tick
  applySnapshot(s: WorldSnapshot): void; // called by loop (throttled)
  reset(): void;
}
```

`types/commands.ts`:

```ts
type Command =
  | { kind: "BuildRobot"; baseId: string; order: BuildOrder }
  | { kind: "AssignTask"; robotId: string; script: RobotScript }
  | { kind: "MoveTo"; robotId: string; dest: Vec2 };
```

**Key point — how a React click reaches the Pixi world:**
`Button onClick` → store action (`enqueueCommand({kind:'AssignTask', ...})`) → next `GameLoop.update()` calls `store.drainCommands()` → applies each command to `world` (the engine's mutable state) → simulation proceeds → loop writes a throttled snapshot back via `applySnapshot()` → subscribed React panels re-render. React never touches Pixi objects; Pixi never touches React.

`store/selectors.ts`: `selectSelectedRobot`, `selectPlayerQueue`, `selectResources`, `selectGameStatus` — keep component subscriptions narrow to avoid re-render storms.

---

## 9. UI / Control Panels (React)

- **StatusPanel** — resources per side, current production queue with build progress bars (`common/Bar.tsx`).
- **ProgrammingPanel** — list of player robots (idle highlighted) → select → `TaskPicker`. For `AttackBase`, prompts "click enemy base" and reads the canvas-picked id.
- **BuildRobotModal** — `ChassisPicker` (3) + `WeaponPicker` (2–3) → confirm → `enqueueCommand({kind:'BuildRobot'})`.
- **GameOverModal** — shows on `status === 'won' | 'lost'`; Restart calls `store.reset()` and re-inits the world.
- **HP/health indicators over units:** drawn **in Pixi** on the `overlay` layer (a small `Graphics` bar under each `RobotView`/`BaseView`), NOT as React DOM — DOM overlays that track world-space, camera-panned objects every frame are costly and jittery. React handles only the fixed HUD chrome.

---

## 10. Development Phases (incremental, verify each)

**Phase 1 — Project setup & empty field.** Strip Vite demo. Build App shell (HUD region + game viewport). `GameApp` + `useGameApp` mount a Pixi `Application` into `GameCanvas`. `Grid` + `Camera` render a pannable top-down grid. Empty Zustand store. ✅ _Verify:_ `npm run dev` shows a scrollable grid; StrictMode mount/unmount leaves no leaked canvas; `npm run lint` + `tsc -b` clean.

**Phase 2 — Bases.** `Base` type, `createBase`, `BaseView` (colored square + HP bar). Place player + AI bases from `gameConfig`. Store holds bases; loop renders them. ✅ _Verify:_ two bases visible at correct tiles with HP bars.

**Phase 3 — Robots + movement.** `Robot` type/factory, `RobotView` (chassis shape + weapon marker + HP bar), `movement.ts` (move to destination), pointer input to select a robot and right-click a tile to move. ✅ _Verify:_ spawn 2–3 robots of different chassis (distinct shapes/colors); click-move works; camera pan unaffected.

**Phase 4 — Task system.** `tasks/*`, `taskRunner` FSM, `ProgrammingPanel` + `TaskPicker`, command queue wiring (`AssignTask`). ✅ _Verify:_ assign Guard (robot holds position), AttackBase (robot drives to enemy base) via the panel.

**Phase 5 — Combat.** `combat.ts`, `Projectile`/`ProjectileView`, `ExplosionView`, collisions, damage, `reapDead`, win/lose on base destruction. ✅ _Verify:_ a robot on AttackBase destroys the enemy base → explosion → GameOverModal (win).

**Phase 6 — Enemy AI.** `aiManager` spawn timers + randomized builds + staged strategy (guard → attack bases → attack robots), `spawn.ts` production from queue. ✅ _Verify:_ AI base periodically produces robots that defend then attack; a full player-vs-AI skirmish resolves.

**Phase 7 — UI & state polish.** Full `StatusPanel` (resources, production progress), `BuildRobotModal`, narrowed selectors, snapshot throttling tuned. ✅ _Verify:_ player can build robots via UI; HUD reflects live counts/resources without React re-render jank.

**Phase 8 — Polish.** Sound (optional `howler`), better explosion/movement tweening, main menu + victory/defeat screens, balance pass in `gameConfig`, replace placeholder `Graphics` with sprite textures (view interfaces unchanged). ✅ _Verify:_ full playable loop from menu → match → win/lose → restart.

---

## Verification (overall)

- After every phase: `npm run dev` (manual play-test of the phase's ✅ criteria), `npx tsc -b` (types clean under the strict tsconfig — remember: no `enum`, no ctor param properties), `npm run lint`.
- Watch for StrictMode double-mount leaks in `useGameApp` (destroy Pixi app + remove ticker listeners on cleanup).
- Keep `engine/` and `pixi/` free of React imports; keep `components/` free of Pixi imports — this boundary is the architecture's load-bearing invariant.
- (Optional) add `vitest` in Phase 5+ to unit-test pure engine modules (`combat`, `movement`, `taskRunner`) with a mock `World`.
