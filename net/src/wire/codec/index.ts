/**
 * The seam between the wire and the game. Everything crossing the socket is BARE
 * (generated from `protocol/schema/messages.bare`); everything above this module
 * is the game's own vocabulary. It is the only place that knows both, which is
 * what lets the two evolve separately — the wire calls a chassis
 * `ChassisType.Tracks`, the game calls it `'tracks'`, and neither has to give in.
 *
 * Three files, in the order a frame meets them: `enums.ts` (domain ↔ wire value
 * tables), `commands.ts` (command + build-order translation), `frames.ts`
 * (encode/decode a whole frame).
 *
 * Division of labour with `../validation`: **BARE proves the shape** (this is a
 * `MoveRobots` with a list of strings and a pair of f64s), **valibot proves the
 * meaning** (the list isn't empty or absurdly long, the point is a real place on
 * the current map). Decoding a frame here does not make its contents safe, so
 * `LockstepSession` still runs the semantic layer over the result.
 */
export { decodeServerMessage, encodeTick, ErrorCode, type DecodedMessage, type WorldCheck } from './frames';
export { mapSizeToQueryParam } from './enums';
