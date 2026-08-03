import { CHAT_ID_LENGTH, CHAT_PATH, QueryParam } from '@drone-directive/protocol';
import { Chat } from './Chat';
import { Room } from './Room';

// Durable Object classes must be named exports from the Worker entry so wrangler
// can bind them (see `class_name` in wrangler.toml).
export { Chat, Room };

export interface Env {
  ROOM: DurableObjectNamespace;
  CHAT: DurableObjectNamespace;
}

/**
 * Worker entry: routes each WebSocket upgrade to the Durable Object that owns it —
 * a `Room` for a match (addressed by the `?room=` code the host generated), a
 * `Chat` for a conversation (addressed by the opaque `?chat=` id the relay issued
 * in `start`). Two objects, two lifetimes, one stateless Worker in front.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return new Response('ok');

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    if (url.pathname === CHAT_PATH) {
      const chatId = url.searchParams.get(QueryParam.ChatId);
      // Holding the id *is* the access, so a short one is refused outright rather
      // than allowed to address an object anyone could have guessed.
      if (!chatId || chatId.length < CHAT_ID_LENGTH) return new Response('Missing chat id', { status: 400 });
      return env.CHAT.get(env.CHAT.idFromName(chatId)).fetch(request);
    }

    const roomCode = url.searchParams.get(QueryParam.Room);
    if (!roomCode) return new Response('Missing room code', { status: 400 });

    const stub = env.ROOM.get(env.ROOM.idFromName(roomCode));
    return stub.fetch(request);
  },
};
