import { applySidePlacements, gameConfig } from '../../config/gameConfig';
import { clampAiOpponents, type GameSettings } from '../../config/gameSettings';
import type { Command } from '@drone-directive/types/commands';
import type { DroneControl, ResourcePool, Vec2 } from '@drone-directive/types/entities';
import { Controller, Difficulty, Owner, PLAYABLE_OWNERS } from '@drone-directive/types/enums';
import { generateObstacles, movementGrid, sightGrid, type ObstacleGrid, type TerrainGrid } from '../obstacles';
import type { EcsWorld } from '../ecs/world';
import { createOrcaSteering, type OrcaSteering } from '../systems/orca';
import type { GameBus } from './eventBus';
import { createRng, type Rng } from '../../utils/rng';

/**
 * The observer-drone input for one fixed step, set by the app bridge (mirrors the
 * `paused` control flag) and consumed by `droneSystem`. Re-exported rather than
 * declared here: it also crosses the wire, so the type itself lives in the shared
 * package where both the engine and `@drone-directive/net` can reach it.
 */
export type { DroneControl };

/** One side of the match: which owner it is, and who gives it orders. */
export interface SideSetup {
  owner: Owner;
  controller: Controller;
}

/**
 * Who's playing, in seating order. Built from `settings.match` by `buildRoster`,
 * so every peer derives the same list from the same settings — the order drives
 * spawn order and per-side iteration, both of which must match across peers.
 */
export type Roster = SideSetup[];

/**
 * Free-for-all seating. Offline: the local human plus `aiOpponents` bots.
 * Online: host (`Player`) and guest (`AI`) are the two humans — matching the
 * lobby's side assignment — and the bots fill the remaining corners.
 */
export function buildRoster(match: GameSettings['match']): Roster {
  const humans = match.online ? 2 : 1;
  const bots = clampAiOpponents(match.aiOpponents, match.online);
  return PLAYABLE_OWNERS.slice(0, humans + bots).map((owner, i) => ({
    owner,
    controller: i < humans ? Controller.Human : Controller.Bot,
  }));
}

/**
 * Mutable bot production state (per bot side, per match). Attack-group size is
 * *not* here: it belongs to the `GroupAttack` program, which counts its own
 * gathering units — see `systems/task.ts`.
 */
export interface AiState {
  timer: number;
  nextIn: number;
  interval: number;
  /** Cursor into the AI's build preset sequence (wraps). */
  buildStep: number;
  /**
   * Observer-drone pilot: the sweep point it is flying to, re-picked on arrival
   * (see `systems/aiDrone.ts`). Undefined = pick one on the next tick, which is
   * also how a shot-down drone's replacement starts fresh.
   */
  droneWaypoint?: Vec2;
}

/**
 * A team's shared battlefield knowledge. `visibleRobotIds`/`visibleAirIds` are
 * recomputed fresh every tick (an enemy robot or flyer is "known" only while some
 * ally currently has it in sight — it moves, so this is not persisted);
 * `knownBaseIds` only grows (a base doesn't move, so once discovered it stays
 * discovered).
 */
export interface TeamIntel {
  visibleRobotIds: Set<string>;
  /**
   * Enemy **air** in sight right now — what anti-air fire may engage. Both kinds
   * of flyer share one set on purpose: an observer drone and an FPV strike drone
   * are spotted by the same rule and shot at by the same weapons, so splitting
   * them would only invite one of the two to be forgotten at a call site.
   */
  visibleAirIds: Set<string>;
  /**
   * Enemy bases some ally has in sight **right now**. The live counterpart to
   * `knownBaseIds`, and the two must not be confused: a building that was found
   * an hour ago is *known* forever but *visible* only while someone is looking at
   * it. Directives target the remembered set (a unit ordered to attack a base
   * should march there without an escort holding the door open); anything that
   * needs a live observer — a salvo launched across the map — reads this one.
   */
  visibleBaseIds: Set<string>;
  knownBaseIds: Set<string>;
}

function emptyIntel(): TeamIntel {
  return {
    visibleRobotIds: new Set(),
    visibleAirIds: new Set(),
    visibleBaseIds: new Set(),
    knownBaseIds: new Set(),
  };
}

function emptyDroneControl(): DroneControl {
  return { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false };
}

function emptyAiState(): AiState {
  return {
    timer: 0,
    nextIn: gameConfig.ai.firstSpawnDelay,
    interval: gameConfig.ai.spawnInterval,
    buildStep: 0,
  };
}

/**
 * A fresh entry for every `Owner` — including `Neutral` and sides sitting this
 * match out, so per-side lookups are total and never need a `?? fallback`.
 */
function byOwner<T>(make: () => T): Record<Owner, T> {
  const out = {} as Record<Owner, T>;
  for (const owner of Object.values(Owner)) out[owner] = make();
  return out;
}

/** The sides this roster seats as bots — the only ones difficulty touches. */
function botOwners(roster: Roster): Set<Owner> {
  return new Set(roster.filter((s) => s.controller === Controller.Bot).map((s) => s.owner));
}

/**
 * Starting wallets. Humans all get the same one; a bot's is scaled by the
 * difficulty table (1× on Normal). `Neutral` holds one it can never spend.
 */
function startingResources(bots: Set<Owner>, difficulty: Difficulty): ResourcePool {
  const base = gameConfig.economy.startingResources;
  const scale = gameConfig.difficulty[difficulty].aiStartingResources;
  const out = byOwner<number>(() => base);
  for (const owner of bots) out[owner] = base * scale;
  return out;
}

/**
 * Per-side income multiplier for `stepEconomy`: `1` for every human side, the
 * difficulty table's `aiIncome` for the bots. This is the difficulty curve —
 * with no starting robots, how fast a side can *afford* an army is the whole
 * of it, and a bot that is gated by `canAfford` needs nothing else changed.
 */
function incomeRates(bots: Set<Owner>, difficulty: Difficulty): Record<Owner, number> {
  const scale = gameConfig.difficulty[difficulty].aiIncome;
  const out = byOwner(() => 1);
  for (const owner of bots) out[owner] = scale;
  return out;
}

/**
 * The player's fog-of-war tile mask (`[ty][tx]`), recomputed by `fogSystem`.
 * `visible` is this tick's friendly sight; `explored` only grows (terrain is
 * static, so remembered ground stays revealed). `version` bumps on any change
 * so the renderer can skip redraws.
 */
export interface FogState {
  explored: boolean[][];
  visible: boolean[][];
  version: number;
}

function emptyGrid(): boolean[][] {
  const { width, height } = gameConfig.grid;
  return Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

/**
 * Everything the systems need for one match. The ECS `world` holds entities;
 * globals (resources/obstacles/rng/difficulty) live here, not on entities. The
 * `bus` carries discrete events out; `commands` is the drained UI intent queue.
 */
export interface GameContext {
  world: EcsWorld;
  bus: GameBus;
  resources: ResourcePool;
  /**
   * Income multiplier per side, applied by `economySystem` — `1` for humans, the
   * difficulty table's `aiIncome` for bots. Fixed for the match.
   */
  incomeRate: Record<Owner, number>;
  /** Per-tile terrain kind — what the renderer draws, and what the two grids below derive from. */
  terrain: TerrainGrid;
  /** Terrain-only *impassable* grid (mountains + craters): pathfinding and roam-target picking. */
  obstacles: ObstacleGrid;
  /**
   * Terrain-only *sight/fire-blocking* grid (mountains only): line of sight and
   * projectile collision. Craters are absent here — robots shoot across them.
   */
  sightBlockers: ObstacleGrid;
  /** Pathfinding grid: `obstacles` + living base footprints (see `navGrid.ts`). */
  navObstacles: ObstacleGrid;
  /**
   * Bumped every time `navObstacles` is rebuilt. Lets a cached pathfinding result
   * — including a cached *failure* — know whether the ground it was computed over
   * still exists.
   */
  navVersion: number;
  rng: Rng;
  /** The difficulty actually in force — already clamped to Normal online, see `createGameContext`. */
  difficulty: Difficulty;
  settings: GameSettings;
  /** True for networked matches: the second human side is a real peer. */
  online: boolean;
  commands: Command[];
  /** Who is playing this match, in seating order — see `buildRoster`. */
  roster: Roster;
  /** Bot state, one entry per `Controller.Bot` side; human sides have none. */
  ai: Partial<Record<Owner, AiState>>;
  /** Per-side detection state — see `TeamIntel`. */
  intel: Record<Owner, TeamIntel>;
  /** Per-side observer-drone input for this step (set by the app bridge / lockstep). */
  droneControl: Record<Owner, DroneControl>;
  /**
   * Seconds left until a shot-down drone is replaced, per side; `0` means the
   * side has its drone (or has no base left to build one). See
   * `systems/droneRespawn.ts` — the HUD reads it for the readiness bar.
   */
  droneRespawn: Record<Owner, number>;
  /** Which side this client views as "theirs" (fog/camera/HUD). Presentation only — never networked. */
  localSide: Owner;
  /** Player fog-of-war tile mask (recomputed by `fogSystem`). */
  fog: FogState;
  /**
   * Local-manoeuvring solver, with the persistent buffers that keep it from
   * allocating every tick.
   *
   * On the context rather than a module singleton because the buffers are
   * per-match state and should die with the match. A singleton would in fact work
   * today — `GameEngine.tick` is synchronous, so the two engines
   * `game/determinism.test.ts` runs side by side never interleave a solve — but
   * it would be correct by accident, and the accident is one `await` away from
   * ending. Owning it here also means no `reset()` anybody can forget, which is
   * exactly the hazard the global `nextId` counter needs `resetIds()` for.
   */
  orca: OrcaSteering;
}

/** Builds a fresh per-match context (new rng, obstacles, resources, AI timers). */
export function createGameContext(
  world: EcsWorld,
  bus: GameBus,
  commands: Command[],
  settings: GameSettings,
  /** Shared RNG seed for networked matches; falls back to the clock for solo play. */
  seed?: number,
): GameContext {
  const rng = createRng(seed !== undefined ? seed >>> 0 : (Date.now() & 0xffffffff) >>> 0);
  const roster = buildRoster(settings.match);
  // Seat the sides before `generateObstacles` — the terrain is carved around the
  // placements. The corners are drawn from the (seeded) match rng, so a match
  // isn't always the same layout and networked peers still agree.
  applySidePlacements(
    roster.map((s) => s.owner),
    rng,
  );
  const terrain = generateObstacles(rng);
  const obstacles = movementGrid(terrain);
  // Online matches force Normal: difficulty never crosses the wire (`StartMessage`
  // has no field for it), and a setting only one peer knows would desync the two
  // worlds the moment a bot's wallet diverged. Clamped here, once, so everything
  // downstream can read `ctx.difficulty` plainly.
  const difficulty = settings.match.online ? Difficulty.Normal : settings.match.difficulty;
  const bots = botOwners(roster);
  return {
    world,
    bus,
    resources: startingResources(bots, difficulty),
    incomeRate: incomeRates(bots, difficulty),
    terrain,
    obstacles,
    sightBlockers: sightGrid(terrain),
    // Seeded with terrain only; GameScene.enter stamps base footprints once bases exist.
    navObstacles: obstacles,
    navVersion: 0,
    rng,
    difficulty,
    settings,
    online: settings.match.online,
    commands,
    roster,
    ai: Object.fromEntries(
      roster.filter((s) => s.controller === Controller.Bot).map((s) => [s.owner, emptyAiState()]),
    ) as Partial<Record<Owner, AiState>>,
    intel: byOwner(emptyIntel),
    droneControl: byOwner(emptyDroneControl),
    droneRespawn: byOwner(() => 0),
    localSide: Owner.Player,
    fog: { explored: emptyGrid(), visible: emptyGrid(), version: 0 },
    orca: createOrcaSteering(),
  };
}
