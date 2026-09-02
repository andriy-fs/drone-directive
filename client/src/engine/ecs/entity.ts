import type { BuildOrder, Vec2 } from '@drone-directive/types/entities';
import type {
  BuildPresetType,
  ChassisType,
  Owner,
  RobotState,
  TaskType,
  WeaponType,
} from '@drone-directive/types/enums';
import type { RobotScript } from '@drone-directive/types/tasks';

/** Robot navigation component. */
export interface Movement {
  speed: number;
  state: RobotState;
  /**
   * Velocity actually driven last tick, px/second — what `movementSystem` moved
   * the hull by, divided by `dt`, excluding whatever `separationSystem` did to it
   * afterwards. Zero for a hull that held station.
   *
   * Written by whichever system did the driving: `movementSystem` for a hull under
   * its own orders, `droneSystem` for one under a pilot (it moves `position`
   * itself, so the pass that follows it carves the hull out rather than measuring
   * its own inaction and calling that the answer).
   *
   * Required rather than optional, deliberately. A reciprocal avoidance layer's
   * whole premise is a statement about what the *neighbour* is doing, and an
   * `undefined` velocity is one every agent silently reads as "parked" — the one
   * reading that makes two units drive into each other. Making it non-optional
   * puts that on the compiler instead of on whoever writes the next spawn site.
   */
  velX: number;
  velY: number;
  destination?: Vec2;
  path?: Vec2[];
  goal?: Vec2;
  /** Anti-jam bookkeeping (movement system): seconds with ~no net progress. */
  stuckTime?: number;
  /**
   * Orbit detection (ORCA pass only). `stuckTime` measures per-tick displacement
   * and a limit cycle defeats it: a hull can jitter 2 px a tick inside a 5 px
   * cell forever and never read as stuck. The anchor measures *net* travel — it
   * is planted where the hull drives, moved only when the hull gets a couple of
   * radii away, and its age is the honest "going nowhere" clock.
   */
  jamAnchorX?: number;
  jamAnchorY?: number;
  jamAnchorAge?: number;
  /** Seconds left of pressing straight down the route, old-layer style. */
  pressTime?: number;
  /**
   * Reliefs already spent on the current anchor. The first fuse presses; a
   * second fuse on the same anchor means the press did not clear it — two
   * pressers grinding head-on never will — so it escalates to the retreat.
   */
  jamReliefs?: number;
  /** Position at the end of the previous tick, to measure net progress. */
  prevX?: number;
  prevY?: number;
  /** Seconds left of an anti-jam retreat, and its direction (radians). */
  retreatTime?: number;
  retreatAngle?: number;
  /**
   * The last pathfinding query that came back with **no route**, memoised on the
   * exact inputs that produced it: start tile, goal tile, and the nav-grid
   * version. `findPath` is a pure function of those three, so repeating the query
   * unchanged cannot produce a different answer.
   *
   * This is a performance guard, and the thing it guards against is severe. A
   * failed search is the most expensive kind — it exhausts every reachable tile
   * before giving up, and `findPath` picks its next node by linear scan, so on a
   * 60x60 grid one costs ~8 ms against a 33 ms frame. `setGoal` cannot cache on
   * the goal tile alone (a robot with no destination must be allowed to ask
   * again, or an unreachable order becomes a permanent freeze — see
   * `.docs/tasks/local-avoidance.md`), so before this a single robot ordered
   * somewhere disconnected re-ran that search **every tick**, taking 81-89% of
   * the entire frame. Measured on real bot matches, under both avoidance layers.
   */
  noRoute?: { fromTx: number; fromTy: number; goalTx: number; goalTy: number; navVersion: number };
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
  /** Surface-to-air: may engage an enemy observer drone as well as ground targets. */
  canHitAir: boolean;
  /** Seconds a hit disables its target for (dew); 0 = an ordinary weapon that only deals damage. */
  freezeDuration: number;
  /**
   * How many single-use strike drones one pull of the trigger releases (fpv);
   * 0 = an ordinary weapon that fires a projectile. Each munition carries this
   * weapon's own `damage` — see `systems/munition.ts`.
   */
  salvo: number;
  /**
   * Seconds a kamikaze stands still arming before it goes off (bomb); 0 = a
   * weapon with no fuse to burn. See `Arming` and `systems/status.ts`.
   */
  armingTime: number;
}

/** Base production component. */
export interface Production {
  queue: BuildOrder[];
  progress: number;
  /**
   * Whether the order at the head of the queue has been paid for.
   *
   * **Queueing is free; building is what costs.** A player may order anything at
   * any balance — the factory simply will not start until the bank covers the
   * order in front, and this is the flag that says which side of that line the
   * head is on. It is also the only thing the HUD can read to say *why* a queue
   * with something in it is showing no progress.
   *
   * An explicit flag rather than "progress is still zero": the two coincide today
   * only because the loop never runs a system with `dt = 0`, and a payment that
   * repeats every tick is not a bug anybody would enjoy finding.
   */
  funded: boolean;
  /** Repeat this exact order when the queue empties, or null = off (player single-model auto-build). */
  autoBuild: BuildOrder | null;
  /** Auto-production series to cycle through (AI only), or null = off. */
  autoBuildPreset: BuildPresetType | null;
  /** Index into the preset's sequence for the next auto-build refill (wraps around). */
  autoBuildStep: number;
  defaultTask: TaskType | null;
  /**
   * Gathering point for newly produced robots, or null = straight out the door.
   * Only Idle and Guard units obey it — see `productionSystem`.
   */
  rally: Vec2 | null;
}

/** Transient effect component (explosions). */
/**
 * What a transient effect entity looks like. The simulation treats every kind
 * identically (`explosionSystem` just ages them); this only tells the renderer
 * which picture to draw.
 */
export const EffectKind = {
  /** Fireball — a death, or a kamikaze detonation. */
  Blast: 'blast',
  /** Directed-energy discharge — a `dew` round landing on a hull. */
  Emp: 'emp',
  /** A base's energy dome collapsing under fire — a hard shatter, with shards. */
  ShieldBreak: 'shieldBreak',
  /** The same dome powering down on schedule — a soft contraction, no shards. */
  ShieldExpire: 'shieldExpire',
} as const;
export type EffectKind = (typeof EffectKind)[keyof typeof EffectKind];

export interface Effect {
  age: number;
  duration: number;
  /** Peak visual radius (px) the blast grows to; falls back to the default fx radius. */
  maxRadius?: number;
  /** Which picture the renderer draws; absent = `Blast` (the original behaviour). */
  kind?: EffectKind;
}

/** Combat memory: who last hit this robot and how long it stays "under fire". */
export interface Threat {
  attackerId?: string;
  /** Seconds remaining in the under-fire window (decays each tick). */
  underFireLeft: number;
}

/**
 * Temporary knock-out from a directed-energy hit: while `left > 0` the robot does
 * nothing at all — no movement, no fire, no reloading, no spotting, and the drone
 * can't land on it. Only ever created/advanced through `systems/status.ts`.
 */
export interface Disabled {
  /** Seconds left of the knock-out (decays each tick in `taskSystem`). */
  left: number;
}

/**
 * A kamikaze's burning fuse: present from the moment it commits to its blast until
 * the blast happens. While `left > 0` the robot stands still and does nothing —
 * it has already spent itself, and the seconds are the window a defender gets to
 * shoot it before it lands. Committed, not conditional: whatever happens to the
 * target meanwhile, the detonation comes. Only ever created/advanced through
 * `systems/status.ts`, and detonated by `systems/combat.ts`.
 */
export interface Arming {
  /** Seconds left on the fuse (decays each tick in `combatSystem`). */
  left: number;
}

/**
 * Suspended passive repair: while `left > 0` the entity does not regenerate hp.
 * Stamped on *anything* that takes damage — bases have no `threat`, but they
 * must stop repairing under assault just as robots do. Only ever created/
 * advanced through `systems/status.ts`.
 */
export interface RegenLock {
  /** Seconds left before repair resumes (decays each tick in `regenSystem`). */
  left: number;
}

/**
 * A base's "last hope" energy dome, present **only while the dome is up** — its
 * presence is the archetype tag, so `world.with('base', 'position', 'shield')`
 * reads as "domes standing right now" and hands the renderer a view lifecycle
 * for free (the `Drone` pattern below).
 *
 * Being a query tag is also the one rule about it: it must be attached and
 * detached through `world.addComponent`/`world.removeComponent` and nothing
 * else, which is why `systems/shield.ts` is the only file allowed to do either.
 * A plain `base.shield = {...}` compiles and even absorbs damage correctly, but
 * no query ever sees it — the dome would never tick and never be drawn.
 */
export interface Shield {
  /** Dome strength left. Reaching 0 shatters it (`systems/shield.ts` clears the component). */
  hp: number;
  /** Seconds of dome left; decays exactly once per tick in `shieldSystem`. */
  left: number;
}

/**
 * Observer-drone component — doubles as the `drone` archetype tag (its presence,
 * an object, is what `world.with('drone', ...)` matches). A side's flying eye:
 * flies free of obstacles, and while `possessedId` is set it is steering that robot.
 *
 * Every side has one. A human pilots theirs by hand; a bot's is flown by
 * `systems/aiDrone.ts`, which deliberately never possesses or fires — so a bot's
 * drone is the one that is *always* exposed.
 *
 * A drone carries `hp` and can be shot down by surface-to-air fire — but only in
 * free flight: while it possesses a robot it rides inside that hull and is
 * untouchable (see `isTargetableDrone`). Losing one costs the side its eye for
 * `gameConfig.drone.respawnTime` seconds (see `systems/droneRespawn.ts`).
 */
export interface Drone {
  /** Id of the idle robot the drone is currently controlling, or undefined = free flight. */
  possessedId?: string;
  /**
   * Where the player sent it (`MoveDrone`), or undefined = no standing order.
   *
   * The drone's second control channel and the one a **human** flies it by; the
   * per-tick stick is what a *bot* uses. Weaker of the two by rule: it steers only
   * while the stick is neutral. Cleared on arrival and spent on landing, so a
   * drone never resumes a leg its pilot has already finished with. See
   * `systems/drone.ts`.
   */
  goal?: Vec2;
}

/**
 * A single ECS entity: a bag of optional components. Boolean "tag" components
 * (`base`/`robot`/`projectile`/`explosion`/`munition`) drive archetype queries via
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
  /**
   * A single-use FPV strike drone in flight, launched by a `salvo` weapon — the
   * game's second flying entity. Carries no components of its own: it reuses
   * `position`/`heading`, `hp`, `targetId` (locked at launch, never re-picked),
   * `sourceId` (the **launcher**, so a victim's return fire finds something that
   * still exists), `damage`, `ttl` and `weaponType`. See `systems/munition.ts`.
   *
   * **Deliberately not a `drone`.** That component means "this side's eye", and
   * four things read it that way: `droneRespawnSystem` ("the side has no drone →
   * build one"), `DroneView`, `store.droneStatus`, and robot possession. Five
   * munitions wearing that tag would each look like a lost eye. What the two
   * *do* share is being **air**, and that is expressed by the queries in
   * `targeting.ts` (`isAirTarget`) rather than by the tag.
   */
  munition?: true;

  owner?: Owner;

  // Transform
  position?: Vec2;
  heading?: number;

  // Health
  hp?: number;
  maxHp?: number;
  /** Present only while passive repair is suspended by a recent hit — see `systems/status.ts`. */
  regenLock?: RegenLock;

  // Robot build identity (render + production)
  chassis?: ChassisType;
  /** Robot: the equipped weapon. Projectile/munition: which weapon released it (render + sfx pick by this). */
  weaponType?: WeaponType;

  // Robot behaviour
  movement?: Movement;
  weapon?: WeaponComp;
  /** Detection radius (px): enemies within this become "known" to the robot's team. */
  sightRange?: number;
  script?: RobotScript;
  targetId?: string;
  threat?: Threat;
  /** Present only while knocked out by a directed-energy hit — see `systems/status.ts`. */
  disabled?: Disabled;
  /** Present only while a kamikaze's fuse is burning — see `systems/status.ts`. */
  arming?: Arming;

  // Base
  production?: Production;
  footprint?: number;
  /** Present only while the energy dome is up — see `systems/shield.ts`. */
  shield?: Shield;
  /**
   * The dome's single charge is gone — raised at some point this match, whether
   * it still stands or fell long ago. Outliving `shield` is the whole reason it
   * is a second component instead of a field on it.
   */
  shieldSpent?: true;

  // Projectile / munition — `velocity` is the projectile's alone (a munition
  // steers itself at its target every tick, so it has no fixed one).
  velocity?: Vec2;
  damage?: number;
  ttl?: number;
  /** Id of the robot that fired/launched it (for return-fire targeting). */
  sourceId?: string;

  // Explosion
  effect?: Effect;
}

/**
 * The kinds `entitySpawned`/`entityDestroyed` can announce. Deliberately without
 * `munition`: a strike drone never reaches `reapSystem` — it lives and dies
 * entirely inside `systems/munition.ts` — so nothing ever needs to name one here.
 */
export type EntityKind = 'base' | 'robot' | 'projectile' | 'explosion' | 'drone';
