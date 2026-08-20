import { describe, expect, it } from 'vitest';
import { Controller, Difficulty, MapSize } from '@drone-directive/types/enums';
import { gameConfig } from '../../config/gameConfig';
import { createDefaultSettings } from '../../config/gameSettings';
import { isAlive } from '../ecs/guards';
import { bases, robots } from '../ecs/queries';
import { baseFootprintContains } from '../systems/targeting';
import { GameEngine } from './engine';

/**
 * Whole-match invariants, played headless.
 *
 * Everything else in the engine suite tests a system in isolation, which is the
 * right shape for almost everything — and it is structurally blind to the class
 * of defect that only appears when several correct-looking parts meet. The one
 * that prompted this file: `randomPointNear` drew a guard's patrol post off the
 * *terrain* grid, `navGrid` blocks living base footprints, `findPath` snaps a
 * blocked goal onto the nearest free tile, and `roamOutcome` only picks a new
 * target once the robot arrives at this one. Each is defensible alone. Together
 * they parked freshly-built robots inside their own factory for 41 seconds.
 *
 * The engine is pure TypeScript with no Pixi, React or DOM anywhere in it, so a
 * match is just `startMatch` and a loop — vitest's node environment runs it as-is,
 * and a seed makes it reproduce exactly.
 *
 * **Assert invariants, never numbers.** Retreat counts, kill counts and match
 * length all move with every balance change; "no robot is trapped" does not. A
 * test that pins a number here becomes a tax on tuning and gets deleted.
 */

const DT = 1 / 30;
const TICKS = 3600; // two minutes of match time — the long stays only appear once both sides have an army
const SEEDS = [1, 7];

/**
 * A match with both seats on the bot, so the whole map is actually played.
 *
 * Sampling stops the tick the match is decided. After `gameOver` the scene
 * freezes the simulation on purpose (only explosions keep aging, so the outcome
 * transition has something to hold the camera on), and every robot left standing
 * keeps its route, its `state`, and a `prevX` one chassis step behind — stale,
 * mutually consistent, and meaningless. An invariant sampled past that point
 * measures the freeze-frame, not the game: that is exactly what
 * `.docs/issues/stalled-robot-with-a-live-route.md` turned out to be.
 */
function playMatch(seed: number, onTick: (engine: GameEngine) => void): void {
  const settings = createDefaultSettings();
  settings.match.difficulty = Difficulty.Normal;
  settings.match.mapSize = MapSize.Medium;
  settings.match.aiOpponents = 1;

  const engine = new GameEngine();
  engine.startMatch(settings, seed);
  const ctx = engine.context;
  expect(ctx).not.toBeNull();
  if (!ctx) return;
  for (const seat of ctx.roster) (seat as { controller: Controller }).controller = Controller.Bot;

  let over = false;
  engine.bus.on('gameOver', () => {
    over = true;
  });

  for (let t = 0; t < TICKS && !over; t++) {
    engine.tick(DT);
    onTick(engine);
  }
}

describe('a played match', () => {
  it('never leaves a robot parked inside a base footprint', () => {
    // Driving through one is fine and happens constantly; living in one is not.
    // Generous by design: a robot shoved in by separation needs a moment to walk
    // clear, and the defect this catches lasted forty seconds.
    const limit = 5 * 30;

    for (const seed of SEEDS) {
      const stay = new Map<string, number>();
      let worst = 0;

      playMatch(seed, (engine) => {
        const ctx = engine.context;
        if (!ctx) return;
        const homes = bases(ctx.world).entities.filter(isAlive);
        for (const e of robots(ctx.world)) {
          if (!isAlive(e)) continue;
          const inside = homes.some((b) => baseFootprintContains(b, e.position));
          const n = inside ? (stay.get(e.id) ?? 0) + 1 : 0;
          stay.set(e.id, n);
          if (n > worst) worst = n;
        }
      });

      expect(worst, `seed ${seed}: a robot sat in a base footprint for ${worst} ticks`).toBeLessThan(limit);
    }
    // Two seeded matches of two minutes each: seconds of real time, and past
    // vitest's 5 s default once the suite runs them alongside everything else.
  }, 30_000);

  it('never leaves a robot standing still on a route it never drives', () => {
    // 10 seconds of no net progress while holding a route whose end is still out
    // of settling range. Generous on purpose: the worst genuinely-live stall
    // measured across both seeds is 13 ticks (0.4 s), while the sampler artifact
    // this invariant once tripped on ran 599 ticks — the gap between "a robot
    // waiting out a jostle" and "a robot that will never arrive" is enormous,
    // and a threshold in the middle of it survives any amount of tuning.
    const limit = 10 * 30;
    const settling = gameConfig.robots.radius * 2;

    for (const seed of SEEDS) {
      const last = new Map<string, { x: number; y: number }>();
      const streak = new Map<string, number>();
      let worst = 0;

      playMatch(seed, (engine) => {
        const ctx = engine.context;
        if (!ctx) return;
        for (const e of robots(ctx.world)) {
          if (!isAlive(e)) continue;
          const m = e.movement;
          const p = last.get(e.id);
          const moved = p ? Math.hypot(e.position.x - p.x, e.position.y - p.y) : Infinity;
          last.set(e.id, { x: e.position.x, y: e.position.y });

          // Progress is judged against the end of the *route*, not the goal that
          // was asked for: `findPath` snaps an unreachable goal to the nearest
          // free tile, and the unreachable remainder is not the robot's fault.
          const end = m.path && m.path.length > 0 ? m.path[m.path.length - 1] : m.goal;
          const farFromEnd =
            end !== undefined && Math.hypot(end.x - e.position.x, end.y - e.position.y) > settling;

          const n = m.goal && farFromEnd && moved < gameConfig.behavior.stuckEpsilon ? (streak.get(e.id) ?? 0) + 1 : 0;
          streak.set(e.id, n);
          if (n > worst) worst = n;
        }
      });

      expect(worst, `seed ${seed}: a robot held a route it made no progress along for ${worst} ticks`).toBeLessThan(
        limit,
      );
    }
  }, 30_000);
});
