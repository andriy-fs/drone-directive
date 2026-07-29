import { createDefaultSettings } from '../../config/gameSettings';
import { PLAYABLE_OWNERS } from '../../types/enums';
import { generateObstacles, movementGrid, sightGrid } from '../obstacles';
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
  // The seed also pins the per-match enemy-corner roll (it happens inside
  // `createGameContext`), so a test's world layout can't drift between runs.
  const ctx = createGameContext(createEcsWorld(), new EventBus<GameEvents>(), [], createDefaultSettings(), seed);
  for (const owner of PLAYABLE_OWNERS) ctx.resources[owner] = 100000;
  if (seed !== undefined) {
    ctx.rng = createRng(seed);
    ctx.terrain = generateObstacles(ctx.rng);
    ctx.obstacles = movementGrid(ctx.terrain);
    ctx.sightBlockers = sightGrid(ctx.terrain);
    ctx.navObstacles = ctx.obstacles;
  }
  return ctx;
}
