/**
 * Enum-like unions. TS `enum` is disallowed by the project's `erasableSyntaxOnly`
 * tsconfig, so each "enum" is a frozen const map plus a same-named union type
 * derived from it. Import the const for values, the type for annotations.
 */

/**
 * A side in the match — who owns a base, a wallet, an intel bucket and a colour.
 * An `Owner` says nothing about *who steers* it: that's the side's `Controller`.
 * `Player` is always the local human offline; `AI` is the bot offline and the
 * remote human online; `AI2`/`AI3` are always bots. The historical `player`/`ai`
 * strings are kept so sprite filenames, CSS classes and saved data still match.
 */
export const Owner = { Player: 'player', AI: 'ai', AI2: 'ai2', AI3: 'ai3', Neutral: 'neutral' } as const;
export type Owner = (typeof Owner)[keyof typeof Owner];

/**
 * Every side that can hold a base, in seating order — index 0 is the local
 * player, the rest fill up as opponents are added. The order is fixed because
 * spawn order and per-side iteration must be identical on networked peers.
 */
export const PLAYABLE_OWNERS = [Owner.Player, Owner.AI, Owner.AI2, Owner.AI3] as const;

/** Hard cap on sides in one match — one per map corner. */
export const MAX_SIDES = PLAYABLE_OWNERS.length;

/**
 * Who issues a side's orders. Decoupled from `Owner` so any side can be a bot.
 * Deliberately *not* split into local/remote: which human is local differs per
 * client, and the roster must be byte-identical on networked peers. "Which side
 * am I" lives in `ctx.localSide` instead.
 */
export const Controller = { Human: 'human', Bot: 'bot' } as const;
export type Controller = (typeof Controller)[keyof typeof Controller];

export const ChassisType = { Tracks: 'tracks', Wheels: 'wheels', Legs: 'legs' } as const;
export type ChassisType = (typeof ChassisType)[keyof typeof ChassisType];

export const WeaponType = {
  None: 'none',
  Cannon: 'cannon',
  Missiles: 'missiles',
  Bomb: 'bomb',
  Radar: 'radar',
  Ew: 'ew',
  /** Directed-energy weapon — not to be confused with `Ew`: that jams sight with an aura, this one shoots and disables. */
  Dew: 'dew',
  /**
   * Carrier for single-use FPV strike drones: a launch fires a whole salvo of short-lived
   * flying munitions instead of one round. The only weapon that shoots *over* terrain and
   * *beyond* its own line of sight — what bounds it is the side's reconnaissance (a salvo
   * needs a target the team can currently see) and the munitions' flight time.
   */
  Fpv: 'fpv',
} as const;
export type WeaponType = (typeof WeaponType)[keyof typeof WeaponType];

export const TaskType = {
  Idle: 'idle',
  Guard: 'guard',
  AttackBase: 'attackBase',
  AttackRobots: 'attackRobots',
  Scout: 'scout',
  /** Focus-fire a specific ordered target (robot or base) — see `blackboard.attackTargetId`. */
  AttackTarget: 'attackTarget',
  /** Unarmed support role: trail an advancing friendly group, or hold near base for early warning; retreats if hit. */
  Overwatch: 'overwatch',
  /**
   * Perimeter defence keyed on the **base**, not on the robot: intercepts anything
   * that comes within the defence radius of its own base and returns afterwards.
   * Unlike `Guard`, the whole line converges on an intruder instead of only
   * whoever happens to have it inside their own weapon range.
   */
  DefendBase: 'defendBase',
  /**
   * Gathers near its own base until enough allies on the same directive have
   * assembled, then the whole group commits and advances together — see
   * `blackboard.committed`. Holds the base line while it waits.
   */
  GroupAttack: 'groupAttack',
} as const;
export type TaskType = (typeof TaskType)[keyof typeof TaskType];

/**
 * The shape a group of robots holds while it moves and fights. Chosen by the
 * player for a whole selection; *where each robot stands* inside the shape is
 * not chosen at all — the engine derives it from the unit's `WeaponType`, so a
 * jammer is never left at the point and a radar is never the first thing shot.
 *
 * The set is a spectrum of one trade-off, and the numbers in `gameConfig` are
 * what make it real: a tight shape fits inside an `ew` hull's `jamRadius` (150)
 * — and inside a kamikaze's `explosionRadius` (120) as well. `Spread` buys the
 * second at the cost of the first.
 *
 * Three shapes, not five. `column` and `wedge` were offered and withdrawn: the
 * column is now something the *ground* hands out rather than something the player
 * picks — it is the rung the terrain ladder in `systems/task/formation.ts` drops
 * to when the ordered shape will not fit a pass, alongside the single file below
 * it — and the wedge was a fifth point on a three-point axis, differing from the
 * line only in how its ranks were staggered. Every shape here has to be a
 * decision the player can state in a sentence.
 */
export const FormationType = {
  /** Ranks abreast, guns forward — the widest frontage. */
  Line: 'line',
  /** Compact square with the support hulls in the middle cells — the escort shape. */
  Box: 'box',
  /** A line at more than a blast radius' spacing: survives area damage, outgrows the jammer's bubble. */
  Spread: 'spread',
} as const;
export type FormationType = (typeof FormationType)[keyof typeof FormationType];

export const RobotState = {
  Idle: 'idle',
  Moving: 'moving',
  Attacking: 'attacking',
  Guarding: 'guarding',
  Dead: 'dead',
} as const;
export type RobotState = (typeof RobotState)[keyof typeof RobotState];

/**
 * What occupies a terrain tile. Impassable kinds differ in whether they also
 * block line of fire: a `Mountain` rises and stops shots, a `Crater` sinks —
 * robots can't drive through it but they can shoot across it. See
 * `engine/obstacles.ts` (`movementGrid`/`sightGrid`).
 */
export const TerrainKind = { Open: 'open', Mountain: 'mountain', Crater: 'crater' } as const;
export type TerrainKind = (typeof TerrainKind)[keyof typeof TerrainKind];

export const Difficulty = { Easy: 'easy', Normal: 'normal', Hard: 'hard' } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

export const MapSize = { Small: 'small', Medium: 'medium', Large: 'large' } as const;
export type MapSize = (typeof MapSize)[keyof typeof MapSize];

/** Named auto-production sequences a base can cycle through — see `config/buildPresets.ts`. */
export const BuildPresetType = {
  Tracks: 'tracks',
  TracksWheels: 'tracksWheels',
  MixedSquad: 'mixedSquad',
  /** The AI's production series (every 10th unit is a kamikaze, sent at a cluster or the base). */
  AiAssault: 'aiAssault',
} as const;
export type BuildPresetType = (typeof BuildPresetType)[keyof typeof BuildPresetType];
