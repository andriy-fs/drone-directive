import { gameConfig } from '../../config/gameConfig';
import type { GameSettings } from '../../config/gameSettings';
import type { Command } from '../../types/commands';
import type { ResourcePool, Vec2 } from '../../types/entities';
import type { Difficulty } from '../../types/enums';
import { generateObstacles, type ObstacleGrid } from '../obstacles';
import type { EcsWorld } from '../ecs/world';
import type { GameBus } from './eventBus';
import { createRng, type Rng } from '../../utils/rng';

/** Mutable AI production + attack-wave state (per match). */
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
  /** Terrain-only blocked grid (rendering + line of sight). */
  obstacles: ObstacleGrid;
  /** Pathfinding grid: terrain + living base footprints (see `navGrid.ts`). */
  navObstacles: ObstacleGrid;
  rng: Rng;
  difficulty: Difficulty;
  settings: GameSettings;
  commands: Command[];
  ai: AiState;
  /** Per-side detection state — see `TeamIntel`. */
  intel: { player: TeamIntel; ai: TeamIntel };
  /** Player observer-drone input for this step (set by the app bridge). */
  droneControl: DroneControl;
  /** Player fog-of-war tile mask (recomputed by `fogSystem`). */
  fog: FogState;
}

/** Builds a fresh per-match context (new rng, obstacles, resources, AI timers). */
export function createGameContext(
  world: EcsWorld,
  bus: GameBus,
  commands: Command[],
  settings: GameSettings,
): GameContext {
  const rng = createRng((Date.now() & 0xffffffff) >>> 0);
  const { startingResources } = gameConfig.economy;
  const obstacles = generateObstacles(rng);
  return {
    world,
    bus,
    resources: { player: startingResources, ai: startingResources },
    obstacles,
    // Seeded with terrain only; GameScene.enter stamps base footprints once bases exist.
    navObstacles: obstacles,
    rng,
    difficulty: settings.match.difficulty,
    settings,
    commands,
    ai: {
      timer: 0,
      nextIn: gameConfig.ai.firstSpawnDelay,
      interval: gameConfig.ai.spawnInterval,
      buildStep: 0,
      groupTarget: 0,
    },
    intel: { player: emptyIntel(), ai: emptyIntel() },
    droneControl: { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false },
    fog: { explored: emptyGrid(), visible: emptyGrid(), version: 0 },
  };
}
