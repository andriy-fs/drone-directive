import type { With } from 'miniplex';
import { gameConfig } from '../../../config/gameConfig';
import { distance } from '../../../utils/math';
import type { BaseEntity, ShieldedBase } from '../../ecs/archetypes';
import { spawnShieldEnd } from '../../ecs/factory';
import type { Entity } from '../../ecs/entity';
import { shieldedBases } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import { knownEnemyRobots } from '../../targeting';

/**
 * The base's one-shot energy dome — "last hope". One per base per match, for
 * every side including bots.
 *
 * **Armor, not a wall.** Nothing about pathing, line of sight or collision
 * changes while it stands: a dome is not an obstacle, a kamikaze drives right
 * under it, and robots parked beneath it are as exposed as they were. All it
 * does is take the damage aimed at the *building* — from any source, at any
 * position — until it runs out, and the overkill on the hit that breaks it
 * spills through to the base. That single unconditional rule is why the
 * absorption lives in `applyDamage` (`systems/combat.ts`) rather than in each
 * collision test: there is no such state as "inside the dome" to special-case.
 *
 * Like `systems/status.ts`, the component is only ever touched through the
 * functions here, and for a stronger reason than tidiness: `shield` is an
 * archetype tag. `world.with('base', 'position', 'shield')` means "domes
 * standing right now", which is what ticks them and what gives the renderer its
 * view lifecycle — and miniplex only re-evaluates a query through
 * `world.addComponent`/`world.removeComponent`. A plain `base.shield = {...}`
 * compiles, and `applyDamage` would even absorb correctly, but no query would
 * ever see it: the dome would never tick and never be drawn.
 */

/**
 * Whether `e` is absorbing right now.
 *
 * Deliberately `hp > 0` rather than "has the component": there is a window
 * inside a tick where `applyDamage` has already zeroed the dome but
 * `shieldSystem` has not yet cleared it, and a second round arriving in that
 * window must not be stopped by a dome that is already gone.
 */
export function isShielded(e: Entity): e is With<Entity, 'shield'> {
  return (e.shield?.hp ?? 0) > 0;
}

/** Whether `base` could still raise its dome at all: alive, and the one charge unspent. */
export function canRaiseShield(base: BaseEntity): boolean {
  return base.hp > 0 && !base.shieldSpent;
}

/**
 * The HUD's gate: a *known* enemy robot inside the base's own detection radius.
 *
 * Read off `ctx.intel`, never the raw world, so the button can never light up
 * for an enemy the player has not detected. Drones are left out on purpose — a
 * scout hovering past should not invite the player to burn their single charge.
 *
 * Emergent consequence worth knowing before it is reported as a bug: a base is
 * itself a scout (`systems/vision.ts`), so an enemy `ew` robot nearby halves its
 * effective sight (260 → 130) and really does darken this button while an
 * assault is visibly forming. That is working counter-play, not a fault.
 */
export function shieldThreatNear(ctx: GameContext, base: BaseEntity): boolean {
  const pos = base.position;
  const range = base.sightRange;
  return knownEnemyRobots(ctx, base.owner).some((r) => distance(r.position.x, r.position.y, pos.x, pos.y) <= range);
}

/**
 * Both halves of the button's enabled state in one place, so the HUD snapshot
 * and any hotkey can never disagree about it.
 *
 * Note this is *not* what `applyCommand` checks. The engine gates only on state
 * it must (base alive, charge unspent) and lets a pre-cast through: a client
 * that raises the dome early merely wastes its own single charge, which punishes
 * itself, whereas silently dropping a panic-button press would be
 * indistinguishable from the game having frozen.
 */
export function canActivateShield(ctx: GameContext, base: BaseEntity): boolean {
  return canRaiseShield(base) && shieldThreatNear(ctx, base);
}

/**
 * Raises the dome and burns the charge. The only place `shield` is attached.
 * Returns whether anything happened, so callers can stay silent about a refusal.
 */
export function raiseShield(ctx: GameContext, base: BaseEntity): boolean {
  if (!canRaiseShield(base)) return false;
  const { hp, duration } = gameConfig.bases.shield;
  ctx.world.addComponent(base, 'shield', { hp, left: duration });
  ctx.world.addComponent(base, 'shieldSpent', true);
  ctx.bus.emit('shieldRaised', {
    owner: base.owner,
    baseId: base.id,
    pos: { x: base.position.x, y: base.position.y },
  });
  return true;
}

/**
 * Takes `amount` off the dome and returns what spills through to the building —
 * 0 for anything the dome swallowed whole, the overkill on the hit that breaks
 * it, and `amount` untouched for an entity with no dome at all. That last case
 * is what keeps robots standing under a dome exposed without a line of code
 * anywhere else.
 */
export function absorbShieldDamage(e: Entity, amount: number): number {
  const s = e.shield;
  if (!s || s.hp <= 0 || amount <= 0) return amount;
  const absorbed = Math.min(s.hp, amount);
  s.hp -= absorbed;
  return amount - absorbed;
}

/**
 * One step of every standing dome: shatter check, then the timer, then the
 * dome's own repair.
 *
 * Runs between `combatSystem` and `reapSystem`. After combat, so a dome beaten
 * to zero shatters on the very tick it was broken; *before* reap, so a base
 * finished off by the spill-through still shows its dome coming apart instead of
 * the whole thing vanishing silently with the entity.
 */
export function shieldSystem(ctx: GameContext, dt: number): void {
  // Copy: `removeComponent` pulls the entity out of the query mid-iteration.
  for (const base of [...shieldedBases(ctx.world)]) {
    const s = base.shield;
    // Shatter before the timer and before repair. Mending first would top a
    // zeroed dome back up every tick, and it could never actually be broken.
    if (s.hp <= 0) {
      endDome(ctx, base, true);
      continue;
    }
    s.left -= dt; // exactly once per tick — the `systems/status.ts` invariant
    if (s.left <= 0) {
      endDome(ctx, base, false);
      continue;
    }
    // Never suspended by a hit, unlike the base's own repair: a shield that
    // stopped mending under fire would only work out of combat.
    s.hp = Math.min(gameConfig.bases.shield.hp, s.hp + gameConfig.bases.shield.regenPerSecond * dt);
  }
}

/** Drops the dome for good. `shieldSpent` deliberately stays — there is no second one. */
function endDome(ctx: GameContext, base: ShieldedBase, shattered: boolean): void {
  const pos = base.position;
  ctx.world.removeComponent(base, 'shield');
  spawnShieldEnd(ctx.world, pos, shattered);
  ctx.bus.emit('shieldEnded', {
    owner: base.owner,
    baseId: base.id,
    pos: { x: pos.x, y: pos.y },
    shattered,
  });
}
