import { CHAT_PATH, PROTOCOL_VERSION, QueryParam } from '@drone-directive/protocol';
import type { ChatSeat } from './types';

/**
 * Builds the URL a chat socket connects to. Everything the object needs before
 * the first frame — which chat, which seat, how much of the log this client
 * already has — travels as query params, because a socket must target its object
 * before it opens and there is no round trip to spend on a `hello`.
 *
 * `since` is the highest `seq` the client holds. The server answers with exactly
 * the messages above it, which is what makes a reconnect cheap enough to do on
 * every backoff tick.
 */
export function chatConnectUrl(relayUrl: string, opts: { chatId: string; seat: ChatSeat; since?: number }): string {
  const url = new URL(relayUrl);
  url.pathname = CHAT_PATH;
  url.searchParams.set(QueryParam.ChatId, opts.chatId);
  url.searchParams.set(QueryParam.Seat, opts.seat);
  url.searchParams.set(QueryParam.Version, String(PROTOCOL_VERSION));
  if (opts.since && opts.since > 0) url.searchParams.set(QueryParam.Since, String(opts.since));
  return url.toString();
}
