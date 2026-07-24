import { stepEconomy } from '../economy';
import type { GameContext } from '../game/context';

/** Accrues resources for both sides. */
export function economySystem(ctx: GameContext, dt: number): void {
  stepEconomy(ctx.resources, dt);
}
