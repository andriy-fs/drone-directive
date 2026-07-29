import { gameConfig } from '../config/gameConfig';
import type { BuildOrder, ResourcePool } from '../types/entities';
import { PLAYABLE_OWNERS, type Owner } from '../types/enums';

/** Total resource cost of a build order (chassis + weapon). */
export function buildCost(order: BuildOrder): number {
  const e = gameConfig.economy;
  return e.chassisCost[order.chassis] + e.weaponCost[order.weapon];
}

/**
 * Accrues income for every playable side, capped at the maximum. Sides with no
 * base still tick (they simply have nothing to spend it on) — cheaper than
 * consulting the roster, and eliminated sides never build again anyway.
 */
export function stepEconomy(resources: ResourcePool, dt: number): void {
  const e = gameConfig.economy;
  const gain = e.incomePerSec * dt;
  for (const owner of PLAYABLE_OWNERS) {
    resources[owner] = Math.min(e.maxResources, resources[owner] + gain);
  }
}

export function canAfford(resources: ResourcePool, owner: Owner, cost: number): boolean {
  return resources[owner] >= cost;
}

export function spend(resources: ResourcePool, owner: Owner, cost: number): void {
  resources[owner] -= cost;
}
