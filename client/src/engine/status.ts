import type { With } from 'miniplex';
import type { Entity } from './ecs/entity';

/**
 * Temporary status effects. Three today:
 *
 * - the directed-energy knock-out (`dew`), respected by every system that could
 *   let a robot act (`task`, `movement`, `combat`, `vision`, `drone`, `ai`);
 * - the repair lock, which suspends passive regeneration for a while after a hit
 *   (`combat` sets it, `regen` reads it);
 * - the kamikaze's fuse, which holds a bomb still for a beat before it goes off
 *   (`combat` both starts and spends it, `movement` and `task` stand out of its
 *   way).
 *
 * All three are only ever touched through the functions here rather than by poking
 * `entity.disabled` / `entity.regenLock` / `entity.arming` directly, so each rule
 * stays in one place and a fourth effect has somewhere obvious to land.
 *
 * The remaining time is simulation state, advanced exactly once per tick — the
 * knock-out in `taskSystem` (next to `threat.underFireLeft`), the repair lock in
 * `regenSystem`, which unlike `taskSystem` also walks bases, and the fuse in
 * `combatSystem`, which is the only place that can act on it running out.
 */

/**
 * Whether `e` is currently knocked out and must not act. A running knock-out
 * implies the component is there, so this narrows — `canRegen` below cannot,
 * since it is *also* true when the lock is absent.
 */
export function isDisabled(e: Entity): e is With<Entity, 'disabled'> {
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

/** Whether `e`'s passive repair is currently running (i.e. it wasn't hit recently). */
export function canRegen(e: Entity): boolean {
  return (e.regenLock?.left ?? 0) <= 0;
}

/**
 * Suspends passive repair for `seconds`. Like `applyDisable` this *extends* to
 * the longer of the two rather than stacking — being shot twice must not add up
 * to a lock outlasting the fight that caused it.
 */
export function blockRegen(e: Entity, seconds: number): void {
  if (seconds <= 0) return;
  if (!e.regenLock) e.regenLock = { left: seconds };
  else e.regenLock.left = Math.max(e.regenLock.left, seconds);
}

/** Advances the repair lock by one step, dropping the component once it runs out. */
export function decayRegenLock(e: Entity, dt: number): void {
  if (!e.regenLock) return;
  e.regenLock.left -= dt;
  if (e.regenLock.left <= 0) e.regenLock = undefined;
}

/**
 * Whether `e`'s kamikaze fuse is burning right now. Like `isDisabled` this
 * narrows, because a running fuse implies the component is there.
 */
export function isArming(e: Entity): e is With<Entity, 'arming'> {
  return (e.arming?.left ?? 0) > 0;
}

/**
 * Lights the fuse for `seconds`. Deliberately **not** `applyDisable`'s "extend to
 * the longer of the two": a fuse is lit once and burns down. A second call while
 * one is already running is a no-op, so nothing — a re-issued order, a second
 * target coming into range — can push a detonation further away.
 */
export function beginArming(e: Entity, seconds: number): void {
  if (seconds <= 0 || isArming(e)) return;
  e.arming = { left: seconds };
}

/**
 * Advances the fuse by one step. Returns true on the single tick it runs out —
 * that is the caller's cue to detonate, and the component is dropped here so the
 * cue can never be read twice.
 *
 * Unlike the other two decays this one is worth acting on rather than merely
 * observing, which is why it returns anything at all.
 */
export function decayArming(e: Entity, dt: number): boolean {
  if (!e.arming) return false;
  e.arming.left -= dt;
  if (e.arming.left > 0) return false;
  e.arming = undefined;
  return true;
}
