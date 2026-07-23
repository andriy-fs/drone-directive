import type { BuildOrder, Vec2 } from '../../types/entities';
import type { BuildPresetType, ChassisType, Owner, RobotState, TaskType, WeaponType } from '../../types/enums';
import type { RobotScript } from '../../types/tasks';

/** Robot navigation component. */
export interface Movement {
  speed: number;
  state: RobotState;
  destination?: Vec2;
  path?: Vec2[];
  goal?: Vec2;
  /** Anti-jam bookkeeping (movement system): seconds with ~no net progress. */
  stuckTime?: number;
  /** Position at the end of the previous tick, to measure net progress. */
  prevX?: number;
  prevY?: number;
  /** Seconds left of an anti-jam retreat, and its direction (radians). */
  retreatTime?: number;
  retreatAngle?: number;
}

/** Robot weapon component. */
export interface WeaponComp {
  range: number;
  damage: number;
  cooldown: number;
  cooldownLeft: number;
  /** Kamikaze AOE blast radius (px) on detonation; 0 = not a bomb (fires projectiles). */
  explosionRadius: number;
  /** Jamming aura radius (px); >0 halves nearby enemy scouts' sightRange (ew). */
  jamRadius: number;
}

/** Base production component. */
export interface Production {
  queue: BuildOrder[];
  progress: number;
  /** Repeat this exact order when the queue empties, or null = off (player single-model auto-build). */
  autoBuild: BuildOrder | null;
  /** Auto-production series to cycle through (AI only), or null = off. */
  autoBuildPreset: BuildPresetType | null;
  /** Index into the preset's sequence for the next auto-build refill (wraps around). */
  autoBuildStep: number;
  defaultTask: TaskType | null;
}

/** Transient effect component (explosions). */
export interface Effect {
  age: number;
  duration: number;
  /** Peak visual radius (px) the blast grows to; falls back to the default fx radius. */
  maxRadius?: number;
}

/** Combat memory: who last hit this robot and how long it stays "under fire". */
export interface Threat {
  attackerId?: string;
  /** Seconds remaining in the under-fire window (decays each tick). */
  underFireLeft: number;
}

/**
 * Observer-drone component — doubles as the `drone` archetype tag (its presence,
 * an object, is what `world.with('drone', ...)` matches). The player's flying eye:
 * flies free of obstacles, and while `possessedId` is set it is steering that robot.
 */
export interface Drone {
  /** Id of the idle robot the drone is currently controlling, or undefined = free flight. */
  possessedId?: string;
}

/**
 * A single ECS entity: a bag of optional components. Boolean "tag" components
 * (`base`/`robot`/`projectile`/`explosion`) drive archetype queries via
 * `world.with('robot', ...)`. Add new behaviour by adding components + a system,
 * not by subclassing.
 */
export interface Entity {
  id: string;

  // Tags
  base?: true;
  robot?: true;
  projectile?: true;
  explosion?: true;
  /** Observer drone (object-valued tag — also carries possession state). */
  drone?: Drone;

  owner?: Owner;

  // Transform
  position?: Vec2;
  heading?: number;

  // Health
  hp?: number;
  maxHp?: number;

  // Robot build identity (render + production)
  chassis?: ChassisType;
  weaponType?: WeaponType;

  // Robot behaviour
  movement?: Movement;
  weapon?: WeaponComp;
  /** Detection radius (px): enemies within this become "known" to the robot's team. */
  sightRange?: number;
  script?: RobotScript;
  targetId?: string;
  threat?: Threat;

  // Base
  production?: Production;
  footprint?: number;

  // Projectile
  velocity?: Vec2;
  damage?: number;
  ttl?: number;
  /** Projectile: id of the robot that fired it (for return-fire targeting). */
  sourceId?: string;

  // Explosion
  effect?: Effect;
}

export type EntityKind = 'base' | 'robot' | 'projectile' | 'explosion';
