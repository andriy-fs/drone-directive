import { PROTOCOL_VERSION, QueryParam, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@drone-directive/protocol';
import type { MapSize } from '../../types/enums';

/**
 * WebSocket URL of the relay Worker. Baked at build time (the UI is a static site)
 * via `VITE_MULTIPLAYER_URL`; falls back to a local `wrangler dev` for development.
 */
// `||` (not `??`): CI expands an unset `${{ vars.VITE_MULTIPLAYER_URL }}` to an
// empty string, which must also fall back — otherwise `new URL('')` throws.
export const MULTIPLAYER_URL: string = import.meta.env.VITE_MULTIPLAYER_URL?.trim() || 'ws://localhost:8787';

/**
 * Ticks of input delay before a locally-issued command/drone input is applied
 * (~200ms at 30Hz). Higher tolerates more network jitter before stalling, at the
 * cost of laggier-feeling input. Both peers must agree, so it lives here.
 */
export const INPUT_DELAY_TICKS = 6;

/** A random, human-shareable room code (host-generated; unambiguous alphabet). */
export function randomRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Builds the relay connection URL for a host (`create`) or guest, per the wire contract. */
export function connectUrl(opts: { room: string; create?: boolean; mapSize?: MapSize; aiCount?: number }): string {
  const url = new URL(MULTIPLAYER_URL);
  url.searchParams.set(QueryParam.Room, opts.room);
  url.searchParams.set(QueryParam.Version, String(PROTOCOL_VERSION));
  if (opts.create) url.searchParams.set(QueryParam.Create, '1');
  if (opts.mapSize) url.searchParams.set(QueryParam.MapSize, opts.mapSize);
  // Host-only: the guest is told the roster in `start`, not by what it asked for.
  if (opts.create) url.searchParams.set(QueryParam.Ai, String(opts.aiCount ?? 0));
  return url.toString();
}
