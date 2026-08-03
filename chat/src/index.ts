/**
 * `@drone-directive/chat` — the chat boundary: one socket to one `Chat` Durable
 * Object, and nothing else.
 *
 * A sibling of `@drone-directive/net`, with the same rule about what it may
 * touch: the protocol, the shared types and valibot, and no renderer, no React,
 * no store, no game config, no bundler globals. The relay URL is injected via
 * `ChatConfig`, exactly as `LockstepConfig` injects it for the game.
 *
 * Two things differ from `net`, deliberately (see README.md):
 *
 * - the object on the other end **decodes** what it is sent, because it numbers
 *   and stores the log — `Room`'s content-blindness is about relaying a lockstep
 *   tick and does not generalize to a different object with a different job;
 * - validation is **asymmetric**, because chat touches no simulation: the server
 *   is authoritative, and a disagreement between the two sides costs nothing.
 */
export { ChatSession } from './ChatSession';
export { chatConnectUrl } from './config';
export { ChatSeat, type ChatConfig, type ChatHandlers, type ChatMessage } from './types';
export { decodeChatMessage, encodeChatSend, entryFromWire, entryToWire, type DecodedChatMessage } from './wire/codec';
export { parseChatEntry, parseChatHistory } from './wire/validation';
