import { describe, expect, it } from 'vitest';

/**
 * Lockstep hygiene, enforced rather than documented.
 *
 * `utils/math.ts` has carried the rule in prose since it was written — deliberately
 * `Math.sqrt`, never `Math.hypot`, because hypot is not one operation but an
 * algorithm that rescales its arguments to survive overflow, every engine writes
 * that algorithm differently, and one differing last bit ends a networked match on
 * a desync. `Math.random` is banned for the obvious reason: two peers would draw
 * different numbers.
 *
 * Prose did not hold. When this test was added the engine had **three** live
 * violations — two in `systems/movement/avoidance.ts` and one in `obstacles.ts`'s
 * `hasClearance` — all in the movement path, the most desync-sensitive code there
 * is. A rule worth writing down twice is worth a test.
 *
 * Sources come from `import.meta.glob` rather than `node:fs`: the client tsconfig
 * has no `@types/node`, and Vite hands the file contents over at build time
 * anyway. Tests are exempt — a test asserting a distance is not part of the
 * lockstep and reads better with `Math.hypot`.
 *
 * Matches the **call** form, not the name: several files legitimately mention
 * `Math.random` in a comment explaining why they use an id hash instead.
 */

const SOURCES: Record<string, string> = import.meta.glob('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const BANNED = [
  { pattern: /Math\.hypot\s*\(/, name: 'Math.hypot', why: 'not correctly rounded — use vecLength from utils/math' },
  { pattern: /Math\.random\s*\(/, name: 'Math.random', why: 'unseeded — use ctx.rng, or an id hash for a stable choice' },
];

const simulationSources = Object.entries(SOURCES).filter(([path]) => !path.endsWith('.test.ts'));

describe('lockstep hygiene — the engine may not call a non-deterministic primitive', () => {
  it('finds engine sources to check at all', () => {
    // Guards the guard: a glob that matched nothing would make every assertion
    // below vacuously true.
    expect(simulationSources.length).toBeGreaterThan(20);
  });

  for (const { pattern, name, why } of BANNED) {
    it(`never calls ${name} (${why})`, () => {
      const offenders: string[] = [];
      for (const [path, source] of simulationSources) {
        source.split('\n').forEach((text, i) => {
          if (pattern.test(text)) offenders.push(`${path}:${i + 1}`);
        });
      }
      expect(offenders, `${name} is banned in the simulation`).toEqual([]);
    });
  }
});
