import { RadioPriority, radioConfig } from '../../config/radio';
import type { RadioKey, RadioParams } from '../../radio/types';

/**
 * A line the director wants said, before anything has decided whether it gets to
 * be. `unitId` is the speaker's entity id, or null for HQ — it is the key the
 * per-unit cooldown counts against, and it is not the same thing as
 * `params.speaker`, which is the *rendered* identity and survives the unit's death.
 */
export interface PendingLine {
  key: RadioKey;
  params: RadioParams;
  unitId: string | null;
  /** When it was offered. Drives staleness, not the cooldowns. */
  at: number;
}

export interface RadioBudget {
  /** Consider a line. It may be dropped outright, or queued to be said shortly. */
  offer: (line: PendingLine, now: number) => void;
  /** The next line to say, or null if it is not time (or there is nothing). */
  take: (now: number) => PendingLine | null;
  /** New match: forget every cooldown and everything waiting. */
  reset: () => void;
}

/**
 * The pacing layer, kept apart from the bus adapter so it can be tested without a
 * world, a store or a clock — the same split `selectionSound.ts` makes next door.
 *
 * The shape of the problem: engine events arrive in bursts (a single engagement
 * fires `entityDestroyed` five to ten times a second) but the feed can only carry
 * about one line every few seconds before it stops being readable. So this is not
 * a queue that drains — it is a queue that *forgets*, and the interesting decisions
 * are all about what to forget. See `config/radio.ts` for the numbers.
 */
export function createRadioBudget(): RadioBudget {
  let lastLineAt = -Infinity;
  let lastByKey = new Map<RadioKey, number>();
  let lastByUnit = new Map<string, number>();
  let queue: PendingLine[] = [];

  function offer(line: PendingLine, now: number): void {
    const priority = radioConfig.priority[line.key];

    // The same unit reporting the same thing twice before either was said is one
    // event as far as the player is concerned.
    if (queue.some((q) => q.key === line.key && q.unitId === line.unitId)) return;

    // Cooldowns are advisory for `High`: a base falling has to be heard even if
    // the category or the unit spoke a moment ago.
    if (priority < RadioPriority.High) {
      const keyCooldown = radioConfig.keyCooldownMs[line.key];
      if (now - (lastByKey.get(line.key) ?? -Infinity) < keyCooldown) return;
      if (line.unitId !== null && now - (lastByUnit.get(line.unitId) ?? -Infinity) < radioConfig.unitCooldownMs) {
        return;
      }
    }

    queue.push(line);
    if (queue.length > radioConfig.queueDepth) evict();
  }

  /**
   * Make room by dropping the oldest of the least important entries — never the
   * newest, and never a `High` while a `Low` is still sitting there. That is what
   * keeps a brawl (all `Mid`) from burying the base that just fell (`High`).
   */
  function evict(): void {
    let worst = 0;
    for (let i = 1; i < queue.length; i += 1) {
      const a = radioConfig.priority[queue[i].key];
      const b = radioConfig.priority[queue[worst].key];
      if (a < b || (a === b && queue[i].at < queue[worst].at)) worst = i;
    }
    queue.splice(worst, 1);
  }

  function take(now: number): PendingLine | null {
    // Drop anything that has been waiting long enough that the moment it described
    // is over. Saying it now would narrate a fight that already ended.
    queue = queue.filter((q) => now - q.at < radioConfig.queueTtlMs);
    if (queue.length === 0) return null;
    if (now - lastLineAt < radioConfig.minGapMs) return null;

    let best = 0;
    for (let i = 1; i < queue.length; i += 1) {
      const a = radioConfig.priority[queue[i].key];
      const b = radioConfig.priority[queue[best].key];
      if (a > b || (a === b && queue[i].at < queue[best].at)) best = i;
    }
    const [line] = queue.splice(best, 1);

    // Cooldowns start when a line is *said*, not when it was offered — otherwise a
    // line that sat in the queue would silence its own category before airing.
    lastLineAt = now;
    lastByKey.set(line.key, now);
    if (line.unitId !== null) lastByUnit.set(line.unitId, now);
    return line;
  }

  function reset(): void {
    lastLineAt = -Infinity;
    lastByKey = new Map();
    lastByUnit = new Map();
    queue = [];
  }

  return { offer, take, reset };
}
