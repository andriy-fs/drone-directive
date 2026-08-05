import type { Entity } from '../ecs/entity';

/**
 * Temporary status effects. Today there is exactly one — the directed-energy
 * knock-out (`dew`) — but every system that has to respect it (`task`,
 * `movement`, `combat`, `vision`, `drone`, `ai`) goes through these three
 * functions rather than poking `entity.disabled` itself, so the rule stays in
 * one place and a second effect has somewhere obvious to land.
 *
 * The remaining time is simulation state: it is part of `worldHash`, and it is
 * advanced exactly once per tick (in `taskSystem`, next to `threat.underFireLeft`).
 */

/** Whether `e` is currently knocked out and must not act. */
export function isDisabled(e: Entity): boolean {
  return (e.disabled?.left ?? 0) > 0;
}

/**
 * Knocks `e` out for `seconds`. Overlapping hits *extend* to the longer of the
 * two rather than stacking — two dew robots focusing one target should not be
 * able to chain it out of the match permanently.
 */
export function applyDisable(e: Entity, seconds: number): void {
  if (seconds <= 0) return;
  if (!e.disabled) e.disabled = { left: seconds };
  else e.disabled.left = Math.max(e.disabled.left, seconds);
}

/** Advances the knock-out by one step, dropping the component once it runs out. */
export function decayDisabled(e: Entity, dt: number): void {
  if (!e.disabled) return;
  e.disabled.left -= dt;
  if (e.disabled.left <= 0) e.disabled = undefined;
}
