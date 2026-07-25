import { QueryParam } from '@drone-directive/protocol';
import { Room } from './Room';

// The Durable Object class must be a named export from the Worker entry so
// wrangler can bind it (see `class_name = "Room"` in wrangler.toml).
export { Room };

export interface Env {
  ROOM: DurableObjectNamespace;
}

/**
 * Worker entry: routes each WebSocket upgrade to the Durable Object for its room
 * code (from the `?room=` query param). The DO does all the pairing/relaying — the
 * Worker itself is stateless.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') return new Response('ok');

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }

    const roomCode = url.searchParams.get(QueryParam.Room);
    if (!roomCode) return new Response('Missing room code', { status: 400 });

    const stub = env.ROOM.get(env.ROOM.idFromName(roomCode));
    return stub.fetch(request);
  },
};
