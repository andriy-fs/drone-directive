import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { createDefaultSettings } from '../../config/gameSettings';
import { Controller, Difficulty, Owner } from '@drone-directive/types/enums';
import { createEcsWorld } from '../ecs/world';
import { createGameContext, type GameContext } from '../game/context';
import type { GameEvents } from '../game/events';
import { EventBus } from '../game/eventBus';
import { economySystem } from './economy';

/**
 * Difficulty is the bots' economy and nothing else: no side is handed starting
 * robots any more, so how fast a bot can *afford* its army is the whole curve.
 * `Normal` is deliberately 1× on both counts — the bot plays by exactly the
 * player's rules — and online is clamped to Normal, since difficulty never
 * crosses the wire and a peer-local value would desync the two worlds.
 */

const SEED = 99;

function ctxFor(difficulty: Difficulty, online = false): GameContext {
  const settings = createDefaultSettings();
  settings.match.difficulty = difficulty;
  settings.match.online = online;
  // One bot either way: offline that is `AI`, online `AI` is the second human and
  // the bot lands on `AI2` — hence `botOwner` below rather than a fixed side.
  settings.match.aiOpponents = 1;
  return createGameContext(createEcsWorld(), new EventBus<GameEvents>(), [], settings, SEED);
}

/** Income accrued by `owner` over one second. */
function incomeOf(ctx: GameContext, owner: Owner): number {
  const before = ctx.resources[owner];
  economySystem(ctx, 1);
  return ctx.resources[owner] - before;
}

function botOwner(ctx: GameContext): Owner {
  const bot = ctx.roster.find((s) => s.controller === Controller.Bot);
  if (!bot) throw new Error('roster seated no bot');
  return bot.owner;
}

describe('economySystem — difficulty scales the bots only', () => {
  it('pays the human side the same income on every difficulty', () => {
    const base = gameConfig.economy.incomePerSec;
    for (const difficulty of [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard]) {
      expect(incomeOf(ctxFor(difficulty), Owner.Player)).toBeCloseTo(base);
    }
  });

  it('pays the bot less on Easy, the human rate on Normal, and more on Hard', () => {
    const rateFor = (d: Difficulty) => {
      const ctx = ctxFor(d);
      return incomeOf(ctx, botOwner(ctx));
    };
    const easy = rateFor(Difficulty.Easy);
    const normal = rateFor(Difficulty.Normal);
    const hard = rateFor(Difficulty.Hard);

    expect(easy).toBeLessThan(normal);
    expect(hard).toBeGreaterThan(normal);
    expect(normal).toBeCloseTo(gameConfig.economy.incomePerSec);
  });

  it('scales the bot starting wallet by the same table, leaving the human wallet alone', () => {
    const start = gameConfig.economy.startingResources;
    for (const difficulty of [Difficulty.Easy, Difficulty.Normal, Difficulty.Hard]) {
      const ctx = ctxFor(difficulty);
      expect(ctx.resources[Owner.Player]).toBe(start);
      expect(ctx.resources[botOwner(ctx)]).toBe(start * gameConfig.difficulty[difficulty].aiStartingResources);
    }
  });

  it('ignores the chosen difficulty online — both peers must run the same numbers', () => {
    const ctx = ctxFor(Difficulty.Hard, true);
    expect(ctx.difficulty).toBe(Difficulty.Normal);
    expect(ctx.resources[botOwner(ctx)]).toBe(gameConfig.economy.startingResources);
    expect(incomeOf(ctx, botOwner(ctx))).toBeCloseTo(gameConfig.economy.incomePerSec);
  });
});
