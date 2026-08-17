import { stepEconomy } from '../economy';
import type { GameContext } from '../game/context';

/** Accrues resources for every side, at that side's difficulty-scaled rate. */
export function economySystem(ctx: GameContext, dt: number): void {
  stepEconomy(ctx.resources, dt, ctx.incomeRate);
}
