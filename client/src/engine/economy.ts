import { gameConfig } from '../config/gameConfig';
import type { BuildOrder, ResourcePool } from '../types/entities';
import { Owner } from '../types/enums';

/** Total resource cost of a build order (chassis + weapon). */
export function buildCost(order: BuildOrder): number {
  const e = gameConfig.economy;
  return e.chassisCost[order.chassis] + e.weaponCost[order.weapon];
}

/** Accrues income for both sides, capped at the maximum. */
export function stepEconomy(resources: ResourcePool, dt: number): void {
  const e = gameConfig.economy;
  const gain = e.incomePerSec * dt;
  resources.player = Math.min(e.maxResources, resources.player + gain);
  resources.ai = Math.min(e.maxResources, resources.ai + gain);
}

export function canAfford(resources: ResourcePool, owner: Owner, cost: number): boolean {
  if (owner === Owner.Player) return resources.player >= cost;
  if (owner === Owner.AI) return resources.ai >= cost;
  return false;
}

export function spend(resources: ResourcePool, owner: Owner, cost: number): void {
  if (owner === Owner.Player) resources.player -= cost;
  else if (owner === Owner.AI) resources.ai -= cost;
}
