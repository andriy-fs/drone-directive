/**
 * The *meaning* half of the network boundary: what a peer's per-tick input is
 * allowed to say. Shape alone is not enough — a well-formed `MoveRobots` naming
 * ten thousand robots at `{ x: NaN }` still decodes and still wrecks the
 * simulation. These schemas check the game's own rules: ids are non-empty and
 * bounded, points land inside the map, and `task`/`chassis`/`weapon` are members
 * of the unions in `@drone-directive/types`.
 *
 * Split in two: `schemas.ts` holds the rules, `parser.ts` decides what a failure
 * costs and how it is reported.
 *
 * The rules that depend on the *current match* arrive as `CommandLimits` rather
 * than being imported. That is what keeps this package free of the game's config:
 * the map is resized between matches, so a captured bound would be wrong anyway,
 * and taking it per call makes the whole layer testable without a running game.
 *
 * **Both sides' batches go through here, not just the peer's** (see
 * `LockstepSession.scheduleLocal`). Under lockstep an asymmetric filter *is* a
 * desync: a command one client applies and the other rejects makes the two worlds
 * diverge. Validation is a pure function of the command plus the limits, and both
 * peers hold the same limits, so both reach the same verdict.
 */
export { parseCommands, parseDroneControl, type CommandOrigin } from './parser';
export type { CommandLimits } from './schemas';
