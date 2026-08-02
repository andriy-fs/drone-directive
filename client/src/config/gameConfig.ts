import { Owner, type MapSize } from '@drone-directive/types/enums';
import type { Rng } from '../utils/rng';

/** Where one side's base starts; `tx`/`ty` is its top-left tile. */
export interface BasePlacement {
  owner: Owner;
  tx: number;
  ty: number;
}

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
    /**
     * Starting placements, one per side in the match; tx/ty is the top-left tile.
     * Rewritten per match by `applyMapSize` (grid size) + `applySidePlacements`
     * (which sides are playing and which corner each drew) — read them live,
     * never copy at module scope. The two entries here are just the resting
     * 1v1 layout before a match is configured.
     */
    placements: [
      { owner: Owner.Player, tx: 4, ty: 33 },
      { owner: Owner.AI, tx: 33, ty: 4 },
    ] as BasePlacement[],
    /** Detection radius (px): a base's own "radar" — enemies within this become known. */
    sightRange: 260,
  },

  /** Observer drone: the player's flying "eye" (see systems/drone.ts). */
  drone: {
    /** Flight speed, px/second (free flight — obstacles never block it). */
    speed: 280,
    /** Detection radius (px): reveals fog + spots enemies like any scout. */
    sightRange: 220,
    /** Max distance (px) to an idle robot to land on / possess it. */
    possessRadius: 40,
    /** Hull strength. At `missiles` damage (22) that's three hits to bring one down. */
    maxHp: 60,
    /** Collision radius (px) for anti-air fire — see `systems/combat.ts`. */
    hitRadius: 14,
    /** Seconds a side spends without an eye after losing one, before a fresh drone rolls out. */
    respawnTime: 30,
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
     * `canHitAir` marks a surface-to-air weapon: only those can shoot an enemy
     * observer drone down (a howitzer plainly can't). Today that's `missiles`
     * alone — a dedicated AA weapon would just be another entry with the flag on.
     */
    weapons: {
      none: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
      },
      cannon: {
        range: 120,
        damage: 12,
        cooldown: 0.8,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
      },
      // The only surface-to-air weapon: doubles as this side's answer to an enemy drone.
      missiles: {
        range: 170,
        damage: 22,
        cooldown: 1.6,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: true,
      },
      // Kamikaze: closes to `range` then detonates, dealing `damage` in `explosionRadius`, destroying itself.
      // range (60) must exceed a base's half-footprint (48px) so it can trigger at the base's edge, not only inside it.
      // damage doubled (150 → 300) so building one is worth it against a base/cluster, not just chip damage.
      bomb: {
        range: 60,
        damage: 300,
        cooldown: 0,
        explosionRadius: 80,
        sightMultiplier: 1,
        jamRadius: 0,
        canHitAir: false,
      },
      /** Unarmed spotter: no damage, but doubles detection radius. */
      radar: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 2,
        jamRadius: 0,
        canHitAir: false,
      },
      /** Unarmed jammer: no damage, but halves the effective sight range of enemy scouts within `jamRadius`. */
      ew: {
        range: 0,
        damage: 0,
        cooldown: 0,
        explosionRadius: 0,
        sightMultiplier: 1,
        jamRadius: 150,
        canHitAir: false,
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
    /** Overwatch: distance (px) behind an advancing friendly group's centroid an unarmed spotter trails at. */
    overwatchTrailDistance: 180,
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
    /**
     * Clusters to attempt on a **small** (40×40) map; `generateObstacles` scales
     * this by map area, so cover density stays constant instead of thinning out
     * to nothing on the large map. This is the knob for "more/less terrain".
     */
    blobCount: 34,
    /** Min tiles per cluster — a cluster below this is too small to be worth pathing around. */
    minBlobTiles: 4,
    /** Max tiles per cluster. Actual size is a random count of *distinct* tiles in `[min, max]`. */
    maxBlobTiles: 16,
    /** Tiles kept clear around each base (Chebyshev) — covers spawns + starters. */
    baseClearMargin: 6,
    /**
     * Chance a cluster is a crater rather than a mountain. Both block driving;
     * only a mountain blocks line of fire, so this is the share of cover that
     * can be shot across (see `engine/obstacles.ts`).
     */
    craterChance: 0.35,
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
    /** Enemy robots within `threatRange` at once, at/above which the AI recalls its whole force (including active attackers) to defend, not just home-based units. */
    massRushThreshold: 5,
    /** Offensive units are staged near base and released together in a wave of this size (inclusive). */
    attackGroupMin: 3,
    attackGroupMax: 10,
    /** Minimum other known enemy robots huddled within the bomb's blast radius before a kamikaze bothers with a cluster run. */
    kamikazeClusterMin: 2,
    /** Chance a freshly-idle kamikaze picks a big enough cluster over rushing the base outright. */
    kamikazeClusterChance: 0.5,
    /** Living-robot-count edge (either side) needed to call the fight lopsided enough to change posture — see `forcePosture`. */
    forceAdvantageMargin: 3,
    /** Extra guard slots (on top of `guardQuota`) filled while in a defensive posture (significantly outnumbered). */
    defensiveGuardBonus: 3,
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

/** Tiles kept clear between a base footprint and the map corner it sits in. */
const CORNER_MARGIN = 4;

/**
 * The corners a base can start in. The player always keeps `bottomLeft` (so the
 * camera, the HUD and the player's own opening never move); the rest are dealt
 * out to the opponents, which is what caps a match at four sides.
 */
export const CORNERS = ['bottomLeft', 'topLeft', 'topRight', 'bottomRight'] as const;
export type Corner = (typeof CORNERS)[number];

/**
 * The corners available to opponents — every corner except the player's. The
 * diagonal leads, so an unshuffled 1v1 seating reproduces the historical layout.
 */
export const ENEMY_CORNERS = ['topRight', 'topLeft', 'bottomRight'] as const satisfies readonly Corner[];

function mutablePlacements(): BasePlacement[] {
  return gameConfig.bases.placements;
}

/** Top-left tile of a base seated in `corner`, on the current grid. */
function cornerTile(corner: Corner): { tx: number; ty: number } {
  const n = gameConfig.grid.width;
  const far = n - gameConfig.bases.footprintTiles - CORNER_MARGIN;
  return {
    tx: corner === 'bottomLeft' || corner === 'topLeft' ? CORNER_MARGIN : far,
    ty: corner === 'bottomLeft' || corner === 'bottomRight' ? far : CORNER_MARGIN,
  };
}

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

  // Keep the historical 1v1 diagonal as the resting value; `createGameContext`
  // seats the real roster right after (and before obstacles are generated).
  applySidePlacements([Owner.Player, Owner.AI]);
}

/**
 * Seats every playing side: the player keeps `bottomLeft`, the opponents draw
 * from the remaining corners (shuffled with `rng` when one is supplied, so a
 * match isn't always the same layout and networked peers still agree).
 *
 * Rewrites `gameConfig.bases.placements` wholesale, so it also decides *how many*
 * bases the match has. Must run **after** `applyMapSize` (it reads the grid size)
 * and **before** `generateObstacles` — the terrain generator keeps a clear margin
 * around whatever the placements say and carries connectivity between them, so
 * seating decided later would leave the map carved for the wrong sides.
 */
export function applySidePlacements(owners: Owner[], rng?: Rng): void {
  const corners: Corner[] = [...ENEMY_CORNERS];
  if (rng) {
    // Fisher-Yates over the non-player corners; `rng.int` keeps it seeded.
    for (let i = corners.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
  }

  const placements = mutablePlacements();
  placements.length = 0;
  let next = 0;
  for (const owner of owners) {
    const corner = owner === Owner.Player ? 'bottomLeft' : corners[next++];
    placements.push({ owner, ...cornerTile(corner) });
  }
}
