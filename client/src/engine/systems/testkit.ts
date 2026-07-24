import { createDefaultSettings } from '../../config/gameSettings';
import { generateObstacles } from '../obstacles';
import { createEcsWorld } from '../ecs/world';
import { createGameContext, type GameContext } from '../game/context';
import type { GameEvents } from '../game/events';
import { EventBus } from '../game/eventBus';
import { createRng } from '../../utils/rng';

/**
 * A fresh match context for tests, with resources maxed so builds always afford.
 * Pass a `seed` to make the RNG (and regenerated obstacles) deterministic — the
 * real `createGameContext` seeds from `Date.now()`, which would flake tests.
 */
export function makeCtx(seed?: number): GameContext {
  const ctx = createGameContext(createEcsWorld(), new EventBus<GameEvents>(), [], createDefaultSettings());
  ctx.resources.player = 100000;
  ctx.resources.ai = 100000;
  if (seed !== undefined) {
    ctx.rng = createRng(seed);
    ctx.obstacles = generateObstacles(ctx.rng);
    ctx.navObstacles = ctx.obstacles;
  }
  return ctx;
}
