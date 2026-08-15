import { describe, expect, it } from 'vitest';
import { radioConfig } from '../../config/radio';
import type { RadioKey } from '../../radio/types';
import { createRadioBudget, type PendingLine } from './radioBudget';

/**
 * The pacing rules, exercised on a hand-cranked clock. These are the numbers that
 * decide whether the feed reads as radio or as a mudslide, and every one of them
 * is easier to get wrong than to notice going wrong in a live match.
 */

const line = (key: RadioKey, at: number, unitId: string | null = null): PendingLine => ({
  key,
  params: {},
  unitId,
  at,
});

describe('minimum gap', () => {
  it('says the first line immediately', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0), 0);
    expect(b.take(0)?.key).toBe('spotted');
  });

  it('holds the next one until the gap has passed, then releases it', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0), 0);
    b.take(0);
    b.offer(line('killed', 100), 100);
    expect(b.take(100)).toBeNull();
    expect(b.take(radioConfig.minGapMs - 1)).toBeNull();
    expect(b.take(radioConfig.minGapMs)?.key).toBe('killed');
  });

  it('is silent with nothing queued', () => {
    expect(createRadioBudget().take(0)).toBeNull();
  });
});

describe('cooldowns', () => {
  it('drops a second line of the same category inside its cooldown', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'a'), 0);
    b.take(0);
    b.offer(line('spotted', 1000, 'b'), 1000);
    expect(b.take(60_000)).toBeNull();
  });

  it('lets the category speak again once the cooldown expires', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'a'), 0);
    b.take(0);
    const after = radioConfig.keyCooldownMs.spotted + 1;
    b.offer(line('spotted', after, 'b'), after);
    expect(b.take(after)?.key).toBe('spotted');
  });

  it('stops one unit monologuing, even across different categories', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'unit-1'), 0);
    b.take(0);
    // `killed` has its own, untouched category cooldown — only the unit blocks this.
    b.offer(line('killed', 5000, 'unit-1'), 5000);
    expect(b.take(60_000)).toBeNull();
  });

  it('lets a different unit speak straight away', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'unit-1'), 0);
    b.take(0);
    b.offer(line('killed', 5000, 'unit-2'), 5000);
    expect(b.take(radioConfig.minGapMs)?.key).toBe('killed');
  });

  it('starts a cooldown when the line is said, not when it was offered', () => {
    const b = createRadioBudget();
    // Offered at 0, said much later: a second offer at the moment it airs must
    // still be inside the category cooldown.
    b.offer(line('spotted', 0, 'a'), 0);
    b.take(3000);
    b.offer(line('spotted', 3001, 'b'), 3001);
    expect(b.take(60_000)).toBeNull();
  });

  it('ignores both cooldowns for a high-priority line', () => {
    const b = createRadioBudget();
    b.offer(line('baseLost', 0, 'unit-1'), 0);
    b.take(0);
    b.offer(line('victory', 10, 'unit-1'), 10);
    expect(b.take(radioConfig.minGapMs)?.key).toBe('victory');
  });
});

describe('deduplication', () => {
  it('collapses the same unit reporting the same thing twice before either aired', () => {
    const b = createRadioBudget();
    b.offer(line('killed', 0, 'unit-1'), 0);
    b.offer(line('killed', 10, 'unit-1'), 10);
    b.take(0);
    expect(b.take(60_000)).toBeNull();
  });
});

describe('queue pressure', () => {
  it('keeps no more than the configured depth', () => {
    const b = createRadioBudget();
    // Distinct units and a high priority, so nothing is dropped by a cooldown.
    for (let i = 0; i < radioConfig.queueDepth + 3; i += 1) {
      b.offer(line('baseLost', i, `unit-${i}`), i);
    }
    let said = 0;
    for (let t = 0; t < 60_000; t += radioConfig.minGapMs) if (b.take(t)) said += 1;
    expect(said).toBe(radioConfig.queueDepth);
  });

  it('drops ambience before news when the queue overflows', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'a'), 0);
    b.offer(line('produced', 1, 'b'), 1);
    b.offer(line('killed', 2, 'c'), 2);
    b.offer(line('baseLost', 3, 'd'), 3); // overflows: the oldest Low goes
    const first = b.take(0);
    expect(first?.key).toBe('baseLost'); // High jumps the line it just joined
    const rest = [b.take(radioConfig.minGapMs), b.take(radioConfig.minGapMs * 2)].map((l) => l?.key);
    expect(rest).toContain('killed');
    expect(rest).not.toContain('spotted');
  });

  it('forgets a line whose moment has passed rather than narrating history', () => {
    const b = createRadioBudget();
    b.offer(line('killed', 0, 'a'), 0);
    expect(b.take(radioConfig.queueTtlMs + 1)).toBeNull();
  });
});

describe('reset', () => {
  it('forgets cooldowns and anything waiting, so a new match starts clean', () => {
    const b = createRadioBudget();
    b.offer(line('spotted', 0, 'a'), 0);
    b.take(0);
    b.offer(line('spotted', 100, 'b'), 100);
    b.reset();
    b.offer(line('spotted', 200, 'c'), 200);
    expect(b.take(200)?.unitId).toBe('c');
  });
});
