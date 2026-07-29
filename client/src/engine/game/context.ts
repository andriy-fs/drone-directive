import { applySidePlacements, gameConfig } from '../../config/gameConfig';
import { clampAiOpponents, type GameSettings } from '../../config/gameSettings';
import type { Command } from '../../types/commands';
import type { ResourcePool, Vec2 } from '../../types/entities';
import { Controller, Owner, PLAYABLE_OWNERS, type Difficulty } from '../../types/enums';
import { generateObstacles, movementGrid, sightGrid, type ObstacleGrid, type TerrainGrid } from '../obstacles';
import type { EcsWorld } from '../ecs/world';
import type { GameBus } from './eventBus';
import { createRng, type Rng } from '../../utils/rng';

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

/** Mutable bot production + attack-wave state (per bot side, per match). */
export interface AiState {
  timer: number;
  nextIn: number;
  interval: number;
  /** Cursor into the AI's build preset sequence (wraps). */
  buildStep: number;
  /** Size of the next attack wave to release, or 0 = roll one on demand. */
  groupTarget: number;
}

/**
 * A team's shared battlefield knowledge. `visibleRobotIds` is recomputed fresh
 * every tick (an enemy robot is "known" only while some ally currently has it
 * in sight — it moves, so this is not persisted); `knownBaseIds` only grows
 * (a base doesn't move, so once discovered it stays discovered).
 */
export interface TeamIntel {
  visibleRobotIds: Set<string>;
  knownBaseIds: Set<string>;
}

function emptyIntel(): TeamIntel {
  return { visibleRobotIds: new Set(), knownBaseIds: new Set() };
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
    groupTarget: 0,
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

/** Every side starts with the same wallet; `Neutral` holds one it can never spend. */
function emptyResources(): ResourcePool {
  return byOwner(() => gameConfig.economy.startingResources);
}

/**
 * The player's observer-drone input for one fixed step, set by the app bridge
 * (mirrors the `paused` control flag). `dir` is a continuous flight direction;
 * the pulses are one-shot edges consumed by `droneSystem`.
 */
export interface DroneControl {
  /** Continuous flight/steer direction; `{0,0}` = hold position. */
  dir: Vec2;
  /** One-shot: land on / take off from a robot this tick. */
  possessPulse: boolean;
  /** One-shot: fire / detonate the possessed robot this tick. */
  firePulse: boolean;
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
  rng: Rng;
  difficulty: Difficulty;
  settings: GameSettings;
  /** True for networked matches: the second human side is a real peer, and starters are symmetric. */
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
  /** Which side this client views as "theirs" (fog/camera/HUD). Presentation only — never networked. */
  localSide: Owner;
  /** Player fog-of-war tile mask (recomputed by `fogSystem`). */
  fog: FogState;
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
  return {
    world,
    bus,
    resources: emptyResources(),
    terrain,
    obstacles,
    sightBlockers: sightGrid(terrain),
    // Seeded with terrain only; GameScene.enter stamps base footprints once bases exist.
    navObstacles: obstacles,
    rng,
    difficulty: settings.match.difficulty,
    settings,
    online: settings.match.online,
    commands,
    roster,
    ai: Object.fromEntries(
      roster.filter((s) => s.controller === Controller.Bot).map((s) => [s.owner, emptyAiState()]),
    ) as Partial<Record<Owner, AiState>>,
    intel: byOwner(emptyIntel),
    droneControl: byOwner(emptyDroneControl),
    localSide: Owner.Player,
    fog: { explored: emptyGrid(), visible: emptyGrid(), version: 0 },
  };
}
