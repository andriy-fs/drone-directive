import type { MapSize } from '../types/enums';

/**
 * Central tunables for the game. Kept dependency-free so both the engine and the
 * Pixi layer can import it without pulling in React or Pixi types.
 */
export const gameConfig = {
  /** Battlefield dimensions, measured in tiles. Resized per match by `applyMapSize`. */
  grid: {
    width: 40,
    height: 40,
    /** Pixel size of a single tile in world space. */
    tilePx: 32,
  },

  /** Tile-count lookup for MapSize presets (square maps: width = height). */
  mapSize: {
    small: 40,
    medium: 60,
    large: 80,
  },

  /** Camera behaviour. */
  camera: {
    /** World units moved per second when panning with the keyboard. */
    keyboardPanSpeed: 600,
    /** Multiplier applied to pointer-drag deltas. */
    dragSpeed: 1,
    minZoom: 0.5,
    maxZoom: 2,
  },

  /** Bases: production points, one per side. */
  bases: {
    // Balance pass (Phase 8): 600 keeps a base assault decisive without dragging.
    maxHp: 600,
    /** Footprint side length, in tiles (occupies footprint x footprint cells). */
    footprintTiles: 3,
    /** Starting placements, keyed by owner; tx/ty is the top-left tile. */
    placements: [
      { owner: "player", tx: 4, ty: 33 },
      { owner: "ai", tx: 33, ty: 4 },
    ],
    /** Detection radius (px): a base's own "radar" — enemies within this become known. */
    sightRange: 260,
  },

  /** Observer drone: the player's flying "eye" (see systems/drone.ts). */
  drone: {
    /** Flight speed, px/second (free flight — obstacles never block it). */
    speed: 320,
    /** Detection radius (px): reveals fog + spots enemies like any scout. */
    sightRange: 220,
    /** Max distance (px) to an idle robot to land on / possess it. */
    possessRadius: 40,
    /** Within this distance (px) of the player base centre the drone counts as "docked" (auto-build stays on). */
    dockRadius: 80,
  },

  /** Robots: per-chassis stats and shared draw/movement tunables. */
  robots: {
    /** Collision / draw radius in pixels. */
    radius: 11,
    /** Distance (px) within which a robot is considered to have arrived. */
    arrivalThreshold: 2,
    /** Stats keyed by ChassisType value. speed is px/second, sight is detection radius in px. */
    chassis: {
      tracks: { hp: 120, speed: 60, sight: 190 },
      wheels: { hp: 70, speed: 120, sight: 230 },
      legs: { hp: 160, speed: 42, sight: 210 },
    },
    /**
     * Weapon stats keyed by WeaponType value. range/cooldown/damage as before.
     * `explosionRadius` (px) only matters for `bomb` — the kamikaze AOE blast
     * radius on detonation. `sightMultiplier` scales the chassis's own `sight`
     * stat (see `chassis` above); only `radar` raises it, everything else is 1
     * (no-op). `jamRadius` (px) only matters for `ew` — see `combat.jamMultiplier`.
     */
    weapons: {
      none: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
      },
      cannon: {
        range: 120,
        damage: 12,
        cooldown: 0.8,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
      },
      missiles: {
        range: 170,
        damage: 22,
        cooldown: 1.6,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
      },
      // Kamikaze: closes to `range` then detonates, dealing `damage` in `explosionRadius`, destroying itself.
      // range (60) must exceed a base's half-footprint (48px) so it can trigger at the base's edge, not only inside it.
      bomb: {
        range: 60,
        damage: 150,
        cooldown: 0,
        explosionRadius: 80,
        sightMultiplier: 1,
        jamRadius: 0,
      },
      /** Unarmed spotter: no damage, but doubles detection radius. */
      radar: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 2,
        jamRadius: 0,
      },
      /** Unarmed jammer: no damage, but halves the effective sight range of enemy scouts within `jamRadius`. */
      ew: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 150,
      },
    },
  },

  /** Combat tunables (projectiles, engagement distances). */
  combat: {
    /** Projectile travel speed, px/second. */
    projectileSpeed: 340,
    /** Projectile lifetime, seconds (also caps effective range). */
    projectileTtl: 1.5,
    /** Projectile collision/draw radius, px. */
    projectileRadius: 3,
    /** Stand-off distance (px) an unarmed attacker stops at so it doesn't jam. */
    unarmedStandoff: 40,
    /** EW jamming aura: multiplies an enemy scout's effective sightRange while inside an `ew` robot's `jamRadius`. */
    jamMultiplier: 0.5,
  },

  /** Reactive behaviour tunables (used by the directive resolver). */
  behavior: {
    /** Seconds a robot stays "under fire" after being hit (drives dodge/return-fire). */
    underFireDuration: 1.2,
    /** Perpendicular strafe distance (px) a dodging robot aims for each tick. */
    evadeDistance: 48,
    /** Max distance (px) a Guard patrols from its post — perimeter defence, not a whole-map search. */
    guardPatrolRadius: 240,
    /**
     * Anti-jam: a robot with a non-idle program that wants to move (has a goal)
     * or is trapped inside a base, yet makes < `stuckEpsilon` px net progress for
     * `stuckAfter` s, backs off — it drives back the way it came (or straight out
     * of a base) for `retreatSeconds` s to clear the jam, then re-approaches.
     * Smooth reversal, not a teleport.
     */
    stuckEpsilon: 0.5,
    stuckAfter: 0.4,
    retreatSeconds: 0.5,
  },

  /** Transient visual effects. */
  fx: {
    /** Explosion lifetime, seconds. */
    explosionDuration: 0.5,
    /** Explosion peak radius, px. */
    explosionMaxRadius: 30,
  },

  /** Starting robot counts per side, by difficulty. */
  difficulty: {
    easy: { player: 3, ai: 2 }, // player starts with one extra
    normal: { player: 2, ai: 2 }, // even
    hard: { player: 2, ai: 3 }, // AI starts with one extra
  },

  /** Randomly generated impassable terrain. */
  obstacles: {
    /** Number of obstacle clusters to attempt to place (1.5× the original 16 — harder routes to the enemy base). */
    blobCount: 24,
    /** Max tiles per cluster (random walk length). */
    maxBlobTiles: 5,
    /** Tiles kept clear around each base (Chebyshev) — covers spawns + starters. */
    baseClearMargin: 6,
  },

  /** Robot production from a base's build queue. */
  production: {
    /** Seconds to build one robot. */
    buildTime: 4,
    /** How far (tiles) beyond the footprint new robots appear. */
    spawnOffsetTiles: 2,
    /** Robots per side allowed at once (built + queued) — same cap for player and AI. */
    maxRobots: 12,
  },

  /** Resource economy: income over time, build costs per side. */
  economy: {
    startingResources: 200,
    /** Resources gained per second, per side. (Phase 8 balance: 10 for tempo.) */
    incomePerSec: 10,
    maxResources: 999,
    /** Build cost by ChassisType value. */
    chassisCost: { tracks: 60, wheels: 50, legs: 80 },
    /** Build cost by WeaponType value. */
    weaponCost: { none: 0, cannon: 40, missiles: 70, bomb: 90, radar: 20, ew: 25 },
  },

  /** Enemy AI behaviour. */
  ai: {
    /** Seconds before the AI enqueues its first build. */
    firstSpawnDelay: 3,
    /** Seconds between subsequent enqueues (shrinks over time). */
    spawnInterval: 6,
    /** Multiplier applied to the interval after each build (escalation). */
    intervalDecay: 0.92,
    /** Interval floor, seconds. */
    minInterval: 2.5,
    /** Guards to station before switching new units to offense. */
    guardQuota: 3,
    /** Spread radius (px) for guard posts around the base. */
    guardRadius: 240,
    /** Enemy within this range (px) of the AI base triggers a defensive unit. */
    threatRange: 220,
    /** Offensive units are staged near base and released together in a wave of this size (inclusive). */
    attackGroupMin: 3,
    attackGroupMax: 10,
  },

  /** HUD snapshot throttle: push roster/HP to the store every N sim ticks. */
  hud: {
    snapshotEveryTicks: 6,
  },

  /** Fixed simulation step, in seconds (30 Hz). */
  fixedDt: 1 / 30,
  /** Safety cap so a long frame (tab refocus) cannot spiral the accumulator. */
  maxFrameDt: 0.25,
} as const;

/** Total world size in pixels, derived from the grid config. */
export const worldPixelSize = {
  width: gameConfig.grid.width * gameConfig.grid.tilePx,
  height: gameConfig.grid.height * gameConfig.grid.tilePx,
} as const;

/**
 * Resizes the battlefield for a new match — call once from `GameEngine.startMatch`,
 * before `createGameContext`/`generateObstacles` run. Mutates `grid`/`worldPixelSize`/
 * base corner placements in place; everything else already reads them live each call
 * (see `obstacles.ts`/`pathfinding.ts`/`coords.ts`), so nothing else needs telling.
 * `applyMapSize('small')` reproduces the original fixed 40×40 layout exactly (same
 * corner margin the original placements used).
 */
export function applyMapSize(size: MapSize): void {
  const n = gameConfig.mapSize[size];
  const grid = gameConfig.grid as { width: number; height: number; tilePx: number };
  grid.width = n;
  grid.height = n;

  const wp = worldPixelSize as { width: number; height: number };
  wp.width = n * grid.tilePx;
  wp.height = n * grid.tilePx;

  const margin = 4; // tiles kept clear from the corner (matches the original layout)
  const fp = gameConfig.bases.footprintTiles;
  const placements = gameConfig.bases.placements as unknown as { owner: string; tx: number; ty: number }[];
  const player = placements.find((p) => p.owner === 'player')!;
  const ai = placements.find((p) => p.owner === 'ai')!;
  player.tx = margin;
  player.ty = n - fp - margin;
  ai.tx = n - fp - margin;
  ai.ty = margin;
}
