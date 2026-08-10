/**
 * Behaviour resolver for robots and base turrets — see `resolver.ts`'s doc
 * comment on `taskSystem` for the tick-order contract.
 *
 * Five files: `types.ts` (the `Outcome`/`MoveIntent` vocabulary directives
 * resolve to), `advancing.ts` (what counts as an advancing "vanguard", shared
 * with `systems/ai.ts`), `roam.ts` (the random-walk/patrol-ring helpers used by
 * several directives), `outcomes.ts` (one function per directive `do` action),
 * `resolver.ts` (`taskSystem` itself: the per-tick program walk, conditions,
 * and the base turret's own target pick).
 */
export { taskSystem } from './resolver';
export { ADVANCING_TASKS, isAdvancing } from './advancing';
export { centroidOf } from './roam';
