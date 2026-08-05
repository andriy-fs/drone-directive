import { gameConfig } from '../../config/gameConfig';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { canRegen, decayRegenLock } from './status';

/**
 * Passive repair: robots and bases slowly claw hp back on their own, at
 * `gameConfig.robots.regenPerSecond` / `gameConfig.bases.regenPerSecond`. Both
 * rates are deliberately tiny (1 hp per 5 s / 2.5 s) — the point is that pulling
 * a damaged unit out of the line eventually pays off, not that anything survives
 * a fight it was losing. Repair stops for `gameConfig.combat.regenDelay` seconds
 * after every hit, which is what keeps it out of the firefight itself (the lock
 * is set by `applyDamage` in `systems/combat.ts`).
 *
 * Runs right after `reapSystem`, so anything at hp<=0 is already gone and no
 * amount of regeneration can pull a corpse back over the line.
 *
 * The observer drone is excluded by construction — neither query matches it. It
 * is replaced wholesale by `droneRespawnSystem` instead, and a self-healing eye
 * would make shooting one down pointless.
 *
 * hp is left fractional on purpose. It is only ever read as a ratio (`hp/maxHp`
 * in the health bars and the status panel) or rounded for display, so no
 * accumulator component is needed: the step is fixed at 1/30 s and the sum is
 * identical on every peer.
 */
export function regenSystem(ctx: GameContext, dt: number): void {
  for (const e of ctx.world.with('robot', 'hp', 'maxHp')) {
    repair(e, gameConfig.robots.regenPerSecond, dt);
  }
  for (const e of ctx.world.with('base', 'hp', 'maxHp')) {
    repair(e, gameConfig.bases.regenPerSecond, dt);
  }
}

/**
 * One entity's step. The lock decays *before* the check (as the knock-out does
 * in `taskSystem`), so the tick a unit's lock expires on is the tick it starts
 * repairing again.
 *
 * Note this is the one system that does not skip a `dew`-disabled robot: repair
 * is passive, not something the hull does, so a knocked-out unit keeps mending.
 */
function repair(e: Entity, rate: number, dt: number): void {
  decayRegenLock(e, dt);
  if ((e.hp ?? 0) <= 0 || !canRegen(e)) return;
  e.hp = Math.min(e.maxHp!, e.hp! + rate * dt);
}
