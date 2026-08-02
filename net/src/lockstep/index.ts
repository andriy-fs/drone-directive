/**
 * **Transport** — the first of the package's three jobs. Owns the relay
 * WebSocket, buffers both sides' per-tick input by tick number, and answers "are
 * both sides ready for tick N?". It decides *when* the simulation may advance;
 * `../wire` decides what a frame means.
 *
 * Three files: `types.ts` (the vocabulary the host talks to it in), `input.ts`
 * (a decoded frame → one tick's `TickInput`), `LockstepSession.ts` (the socket,
 * the buffers, the desync probe).
 */
export { LockstepSession } from './LockstepSession';
export type { LockstepConfig, LockstepHandlers, TickInput } from './types';
