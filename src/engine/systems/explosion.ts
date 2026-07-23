import type { GameContext } from '../game/context';

/** Ages explosion effects and removes the ones that have run their duration. */
export function explosionSystem(ctx: GameContext, dt: number): void {
  for (const e of [...ctx.world.with('explosion', 'effect')]) {
    e.effect!.age += dt;
    if (e.effect!.age >= e.effect!.duration) ctx.world.remove(e);
  }
}
