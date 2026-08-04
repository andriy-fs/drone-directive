import { PROTOCOL_VERSION, QueryParam, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@drone-directive/protocol';
import type { MapSize } from '@drone-directive/types/enums';
import { mapSizeToQueryParam } from './wire/codec';

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

/**
 * Builds the relay connection URL for a host (`create`) or guest, per the wire
 * contract. `relayUrl` is passed in rather than read from the environment: where
 * the relay lives is the host application's business (the client bakes it at
 * build time from `VITE_MULTIPLAYER_URL`), and reading it here would tie this
 * package to one bundler.
 */
export function connectUrl(
  relayUrl: string,
  opts: { room: string; create?: boolean; mapSize?: MapSize; aiCount?: number; resume?: string },
): string {
  const url = new URL(relayUrl);
  url.searchParams.set(QueryParam.Room, opts.room);
  url.searchParams.set(QueryParam.Version, String(PROTOCOL_VERSION));
  if (opts.create) url.searchParams.set(QueryParam.Create, '1');
  // Reclaiming a seat: the token says which seat and proves the right to it, so
  // this replaces the create/join intent rather than joining it.
  if (opts.resume) url.searchParams.set(QueryParam.Resume, opts.resume);
  // Spelled through the codec rather than passed through: the two happen to use
  // the same strings today, and nothing should quietly depend on that.
  if (opts.mapSize) url.searchParams.set(QueryParam.MapSize, mapSizeToQueryParam(opts.mapSize));
  // Host-only: the guest is told the roster in `start`, not by what it asked for.
  if (opts.create) url.searchParams.set(QueryParam.Ai, String(opts.aiCount ?? 0));
  return url.toString();
}
