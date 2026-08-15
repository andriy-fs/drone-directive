import type { RadioKey } from '../radio/types';

/**
 * How often the radio is allowed to talk, and about what.
 *
 * Split out of `radioDirector.ts` on purpose: none of this is logic, all of it is
 * feel. The right numbers are found by playing, and having them in one table means
 * a tuning pass is a diff in this file rather than an edit inside a subscription
 * handler. Dependency-free like the rest of `config/` — it imports one type and
 * nothing else, so both the Pixi adapter and the React feed can read it.
 *
 * The problem these numbers solve: `entityDestroyed` fires five to ten times a
 * second in a real engagement. Left ungated the feed becomes a scrolling wall
 * nobody reads, which is worse than silence — the point of the thing is flavour,
 * and flavour needs air around it.
 */

/**
 * Priority decides what survives a busy moment. `High` is for things the player
 * would be annoyed to miss (a base gone, the match decided): it skips the
 * per-category cooldown and pushes to the front of the queue. `Low` is ambience
 * and is the first thing dropped when the queue is full.
 */
export const RadioPriority = { Low: 0, Mid: 1, High: 2 } as const;
export type RadioPriority = (typeof RadioPriority)[keyof typeof RadioPriority];

export const radioConfig = {
  /**
   * Floor between two lines, whatever their priority. Roughly the time it takes
   * to read one — below about two seconds the feed stops being readable and
   * starts being texture.
   */
  minGapMs: 2500,

  /**
   * Waiting lines. Deep enough that a burst is not simply lost, shallow enough
   * that the feed never narrates a fight that finished ten seconds ago. Overflow
   * evicts the oldest lowest-priority entry, so a `High` line pushed in during a
   * brawl still gets said.
   */
  queueDepth: 3,

  /** A queued line older than this is stale — the moment it described has passed. */
  queueTtlMs: 6000,

  /**
   * One unit does not monologue. Long, because hearing the same callsign three
   * times in a row reads as a bug even when every line is different.
   */
  unitCooldownMs: 15000,

  /** Lines held on screen at once; older ones fade out under the newer. */
  maxLines: 6,

  /** How long a line stays up once it has been said. */
  lineTtlMs: 12000,

  /**
   * Per-category floor. `spotted` is the loudest event in the game (every unit
   * entering sight range fires one), so it gets the longest leash; the terminal
   * events get none, since they can only happen once anyway.
   */
  keyCooldownMs: {
    spotted: 9000,
    spottedBase: 12000,
    killed: 5000,
    killedBase: 0,
    lost: 6000,
    baseLost: 0,
    produced: 8000,
    shieldUp: 0,
    shieldDown: 0,
    shieldShattered: 0,
    enemyEliminated: 0,
    victory: 0,
    defeat: 0,
  } satisfies Record<RadioKey, number>,

  priority: {
    spotted: RadioPriority.Low,
    spottedBase: RadioPriority.Mid,
    killed: RadioPriority.Mid,
    killedBase: RadioPriority.High,
    lost: RadioPriority.Mid,
    baseLost: RadioPriority.High,
    produced: RadioPriority.Low,
    shieldUp: RadioPriority.High,
    shieldDown: RadioPriority.High,
    shieldShattered: RadioPriority.High,
    enemyEliminated: RadioPriority.High,
    victory: RadioPriority.High,
    defeat: RadioPriority.High,
  } satisfies Record<RadioKey, RadioPriority>,

  /**
   * Which lines are read in the alert colour. Everything here is something going
   * wrong for the local player — losses and the dome failing. A kill is good news
   * and stays green even though it is violent.
   */
  alert: {
    spotted: false,
    spottedBase: false,
    killed: false,
    killedBase: false,
    lost: true,
    baseLost: true,
    produced: false,
    shieldUp: false,
    shieldDown: true,
    shieldShattered: true,
    enemyEliminated: false,
    victory: false,
    defeat: true,
  } satisfies Record<RadioKey, boolean>,
} as const;
