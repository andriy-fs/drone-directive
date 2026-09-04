import type { Entity, WeaponComp } from './ecs/entity';
import { munitions } from './ecs/queries';
import type { GameContext } from './game/context';
import { isDisabled } from './status';

/**
 * Whether firing at something would accomplish anything — the fire-decision
 * predicates, split out of `targeting.ts`.
 *
 * `targeting.ts` answers neutral questions about the world ("who is an enemy",
 * "which base is mine", "what is nearest"). These four answer a *policy*
 * question on top of those, and they are the only ones that need to know what a
 * weapon is and whether a target is already knocked out. Keeping them apart is
 * what lets `targeting.ts` stay free of `status.ts`.
 */
/**
 * Damage already on its way to `targetId` — the sum every strike drone still in
 * the air is carrying for it.
 *
 * There is no separate book to keep: a salvo *is* its munitions, each one an
 * entity holding its own `damage` and the id it locked at launch, so the world
 * already answers "how much is committed to this target". Every side's drones
 * count, not just one: a target being finished off by an ally is no more worth a
 * volley than one being finished off by us.
 */
export function incomingSalvoDamage(ctx: GameContext, targetId: string): number {
  let sum = 0;
  for (const m of munitions(ctx.world)) {
    if (m.targetId === targetId && m.hp > 0) sum += m.damage;
  }
  return sum;
}

/**
 * Whether `target` is already dead on paper — the drones in the air will finish
 * it without help. The gate on launching *another* salvo at it, and the reason a
 * dozen carriers watching one scout don't all empty their tubes into it: a
 * launcher's 9-second reload is the expensive thing here, far more so than the
 * five drones, and it is exactly what this saves for the next target.
 *
 * A base's dome counts toward the pool it has to chew through, otherwise the
 * carriers would fall silent in front of a base that is nowhere near falling.
 */
export function alreadyDoomed(ctx: GameContext, target: Entity): boolean {
  const pool = (target.hp ?? 0) + (target.shield?.hp ?? 0);
  return pool - incomingSalvoDamage(ctx, target.id) <= 0;
}

/** Whether `w` is a launcher — one trigger pull, `salvo` flying munitions. */
function isLauncher(w: WeaponComp | undefined): boolean {
  return !!w && w.salvo > 0;
}

/** Whether `w` is a weapon whose only effect is a knock-out (`dew`). */
function isDisabler(w: WeaponComp | undefined): boolean {
  return !!w && w.damage <= 0 && w.freezeDuration > 0;
}

/**
 * Whether `shooter` firing at `target` right now would accomplish anything.
 * Ordinary weapons usually do — damage always lands. Two weapons have empty
 * cases worth skipping:
 *
 * - a **launcher** (`fpv`) aimed at something the drones already in the air will
 *   kill anyway (`alreadyDoomed`);
 * - a **disabler** (`dew`) aimed at a robot that is already knocked out
 *   (`applyDisable` takes the max of the two durations, not their sum, so a
 *   second hit buys almost nothing) or at a base (no crew to knock out —
 *   `stepProjectiles` lets such a shot pass straight through, see `combat.ts`).
 *
 * Being false here does not merely hold fire: this is what automatic *selection*
 * filters on, so the shooter moves on to the next enemy instead of standing over
 * a corpse — which is the whole point for a launcher, where the alternative is
 * nine idle seconds. A player's explicit order (`AttackTarget`, manual piloting)
 * is not filtered by this; the launch-time gate that catches those lives in
 * `fireWeapon`.
 */
export function worthShooting(ctx: GameContext, shooter: Entity, target: Entity): boolean {
  if (isLauncher(shooter.weapon) && alreadyDoomed(ctx, target)) return false;
  if (!isDisabler(shooter.weapon)) return true;
  return !target.base && !isDisabled(target);
}
