/**
 * `@drone-directive/net` — the online boundary: everything between the relay
 * socket and the game's own vocabulary, and nothing else.
 *
 * Three responsibilities, in the order a peer's frame meets them:
 *
 * 1. **Transport** (`LockstepSession`) — owns the socket, buffers both sides'
 *    per-tick input, answers "are both sides ready for tick N?".
 * 2. **Shape** (`wire/codec`) — BARE encode/decode from
 *    `@drone-directive/protocol`, plus the mapping between wire and domain
 *    vocabularies.
 * 3. **Meaning** (`wire/validation`) — valibot rules a decoded message must
 *    still satisfy to be a plausible order in this match.
 *
 * It depends on the protocol and the shared types, and on nothing else — no
 * renderer, no React, no game config, no bundler globals. Anything match-specific
 * (the relay URL, the world bounds) is injected by the host application, which is
 * what lets the package be tested without a running game.
 */
export { LockstepSession, type LockstepConfig, type LockstepHandlers, type TickInput } from './lockstep';
export { connectUrl, INPUT_DELAY_TICKS, randomRoomCode } from './config';
export { setNetDebug } from './debug';
export {
  decodeServerMessage,
  encodeTick,
  ErrorCode,
  mapSizeToQueryParam,
  type DecodedMessage,
  type WorldCheck,
} from './wire/codec';
export { parseCommands, parseDroneControl, type CommandLimits, type CommandOrigin } from './wire/validation';
