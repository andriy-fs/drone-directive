import { gameConfig } from '../config/gameConfig';
import type { BuildOrder, ResourcePool } from '@drone-directive/types/entities';
import { PLAYABLE_OWNERS, type Owner } from '@drone-directive/types/enums';

/** Total resource cost of a build order (chassis + weapon). */
export function buildCost(order: BuildOrder): number {
  const e = gameConfig.economy;
  return e.chassisCost[order.chassis] + e.weaponCost[order.weapon];
}

/**
 * Accrues income for every playable side, capped at the maximum. Sides with no
 * base still tick (they simply have nothing to spend it on) — cheaper than
 * consulting the roster, and eliminated sides never build again anyway.
 *
 * `rate` is the per-side multiplier from `GameContext.incomeRate`: `1` for the
 * humans, the difficulty table's `aiIncome` for the bots.
 */
export function stepEconomy(resources: ResourcePool, dt: number, rate: Record<Owner, number>): void {
  const e = gameConfig.economy;
  for (const owner of PLAYABLE_OWNERS) {
    const gain = e.incomePerSec * rate[owner] * dt;
    resources[owner] = Math.min(e.maxResources, resources[owner] + gain);
  }
}

export function canAfford(resources: ResourcePool, owner: Owner, cost: number): boolean {
  return resources[owner] >= cost;
}

export function spend(resources: ResourcePool, owner: Owner, cost: number): void {
  resources[owner] -= cost;
}
