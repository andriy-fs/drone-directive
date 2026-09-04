import { describe, it, vi } from 'vitest';
import { Controller, Difficulty, MapSize } from '@drone-directive/types/enums';
import { gameConfig } from '../../../../config/gameConfig';
import { createDefaultSettings } from '../../../../config/gameSettings';
import { GameEngine } from '../../../game/engine';
import { bases, projectiles, robots } from '../../../ecs/queries';
import { isAlive } from '../../../ecs/guards';

/** Temporary: do bot-vs-bot matches still resolve with the new avoidance layer? */

const P = vi.hoisted(() => ({ calls: 0, ms: 0, empty: 0, emptyMs: 0, samples: [] as string[] }));

vi.mock('../../../pathfinding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../pathfinding')>();
  return {
    ...actual,
    findPath(...args: Parameters<typeof actual.findPath>) {
      const t = performance.now();
      const r = actual.findPath(...args);
      const d = performance.now() - t;
      P.ms += d;
      P.calls++;
      if (r.length === 0) {
        P.empty++;
        P.emptyMs += d;
        if (P.samples.length < 5) {
          const [grid, from, to] = args;
          const tp = (v: { x: number; y: number }) => `${Math.floor(v.x / 32)},${Math.floor(v.y / 32)}`;
          const blocked = (v: { x: number; y: number }) => {
            const tx = Math.floor(v.x / 32);
            const ty = Math.floor(v.y / 32);
            return grid[ty]?.[tx] ? 'BLOCKED' : 'free';
          };
          P.samples.push(`from tile ${tp(from)} (${blocked(from)}) -> to tile ${tp(to)} (${blocked(to)})`);
        }
      }
      return r;
    },
  };
});

const DT = 1 / 30;
const CAP = 7200; // four minutes

function playToEnd(seed: number): { ticks: number; over: boolean; hp: string; msPerTick: number } {
  const settings = createDefaultSettings();
  settings.match.difficulty = Difficulty.Normal;
  settings.match.mapSize = MapSize.Medium;
  settings.match.aiOpponents = 1;
  const engine = new GameEngine();
  engine.startMatch(settings, seed);
  const ctx = engine.context;
  if (!ctx) throw new Error('no context');
  for (const seat of ctx.roster) (seat as { controller: Controller }).controller = Controller.Bot;

  let over = false;
  engine.bus.on('gameOver', () => {
    over = true;
  });
  let t = 0;
  const t0 = performance.now();
  for (; t < CAP && !over; t++) engine.tick(DT);
  const elapsed = performance.now() - t0;
  void elapsed;

  const hp = bases(ctx.world)
    .entities.filter(isAlive)
    .map((b) => `${b.owner}:${Math.round(b.hp)}`)
    .join(' ');
  return { ticks: t, over, hp, msPerTick: elapsed / Math.max(1, t) };
}

/** Fixed tick budget, no early exit, so both layers do identical work. */
function timeFixed(seed: number, ticks: number): number {
  const settings = createDefaultSettings();
  settings.match.difficulty = Difficulty.Normal;
  settings.match.mapSize = MapSize.Medium;
  settings.match.aiOpponents = 1;
  const engine = new GameEngine();
  engine.startMatch(settings, seed);
  const ctx = engine.context;
  if (!ctx) throw new Error('no context');
  for (const seat of ctx.roster) (seat as { controller: Controller }).controller = Controller.Bot;
  P.calls = 0;
  P.ms = 0;
  P.empty = 0;
  P.emptyMs = 0;
  P.samples = [];
  const t0 = performance.now();
  for (let t = 0; t < ticks; t++) engine.tick(DT);
  const ms = (performance.now() - t0) / ticks;
  const solver = ctx.orca.solver;
  const live = robots(ctx.world).entities.filter(isAlive).length;
  const proj = projectiles(ctx.world).entities.length;
  console.log(
    `        agent-solves ${solver.solveCount} (LP3 ${((solver.fallbackCount / Math.max(1, solver.solveCount)) * 100).toFixed(1)}%)` +
      ` | robots alive ${live} | projectiles ${proj}`,
  );
  return ms;
}

describe('does a bot match still resolve', () => {
  it('plays to the end under both layers', () => {
    const cfg = gameConfig.behavior.orca as { enabled: boolean };
    const was = cfg.enabled;
    try {
      for (const layer of ['steer', 'orca'] as const) {
        cfg.enabled = layer === 'orca';
        for (const seed of [1, 2, 3]) {
          const r = playToEnd(seed);
          console.log(
            `${layer.padEnd(6)} seed ${seed} | ${r.over ? `ended at ${r.ticks}t` : `UNRESOLVED ${r.ticks}t`} | base hp ${r.hp}`,
          );
        }
      }
    } finally {
      cfg.enabled = was;
    }
  }, 900_000);

  it('costs this much per tick, measured fairly', () => {
    const cfg = gameConfig.behavior.orca as { enabled: boolean };
    const was = cfg.enabled;
    const TICKS = 2500;
    try {
      for (const layer of [false, true]) {
        cfg.enabled = layer;
        timeFixed(1, 400);
      }
      for (const layer of ['steer', 'orca'] as const) {
        cfg.enabled = layer === 'orca';
        for (const seed of [1, 2, 3, 4, 5]) {
          const ms = timeFixed(seed, TICKS);
          console.log(
            `${layer.padEnd(6)} seed ${seed} | ${ms.toFixed(3)} ms/tick | findPath ${P.calls}` +
              ` (${P.empty} with no route, ${((P.emptyMs / (ms * TICKS)) * 100).toFixed(0)}% of all time)`,
          );
        }
      }
    } finally {
      cfg.enabled = was;
    }
  }, 1_800_000);
});
