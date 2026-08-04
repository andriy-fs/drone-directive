/**
 * Which selection sound a change of selection deserves — pure, so the rules can
 * be tested without Web Audio, the store or the ECS. Types only, no runtime
 * imports; `selectionAudio.ts` is what turns the answer into a sound.
 */
import { ChassisType } from '@drone-directive/types/enums';

/** The two mutually exclusive selection fields of the store, as this module sees them. */
export interface SelectionSnapshot {
  robotIds: readonly string[];
  baseId: string | null;
}

export type SelectionSound = 'none' | 'base' | 'single' | 'group';

/**
 * Both fields change in a single `set`, and `selectBase`/`selectRobots` clear
 * the other one, so a base↔robots switch shows up as one transition — the base
 * is answered first, then the robots.
 *
 * Deselecting is silent by design: the player asked for a sound on *picking*
 * something, and the auto-clears (a selected base dying, the scene going back to
 * the menu) go through the same empty-selection path.
 */
export function selectionSoundFor(prev: SelectionSnapshot, next: SelectionSnapshot): SelectionSound {
  // A repeat of the same base is not a new selection: `selectBaseOrClear` runs on
  // *every* unhandled left click, so clicking your own base twice must not
  // double-fire the acknowledgement.
  if (next.baseId !== null) return next.baseId === prev.baseId ? 'none' : 'base';

  if (next.robotIds.length === 0) return 'none';
  // Compare as sets, not arrays: `set({ selectedRobotIds })` always yields a new
  // array identity, and a shift-add can reach the same membership in a different
  // order than a fresh marquee would. Without this, Ctrl+A key auto-repeat and a
  // re-pressed control group would each re-announce a selection that never moved.
  if (sameMembers(prev.robotIds, next.robotIds)) return 'none';
  return next.robotIds.length === 1 ? 'single' : 'group';
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const seen = new Set(a);
  return b.every((id) => seen.has(id));
}

/** Fixed order, so the same mix always sounds the same. */
const CHASSIS_ORDER: readonly ChassisType[] = [ChassisType.Tracks, ChassisType.Wheels, ChassisType.Legs];

/**
 * Dedupe the chassis found in a selection and put them in a fixed order — ECS
 * iteration order shifts as entities are spawned and reaped, and the same squad
 * must not sound different from one click to the next.
 */
export function orderChassis(found: readonly ChassisType[]): ChassisType[] {
  return CHASSIS_ORDER.filter((c) => found.includes(c));
}
