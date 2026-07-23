/**
 * Small seedable PRNG (mulberry32) so AI decisions are reproducible when seeded.
 * Used for build randomization and spawn jitter.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next: () => number;
  /** Integer in [0, maxExclusive). */
  int: (maxExclusive: number) => number;
  /** Uniformly pick one item from a non-empty list. */
  pick: <T>(items: readonly T[]) => T;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

/** Shared instance, seeded from the clock for run-to-run variety. */
export const rng: Rng = createRng((Date.now() & 0xffffffff) >>> 0);
