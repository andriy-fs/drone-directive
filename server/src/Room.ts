import { PROTOCOL_VERSION, QueryParam } from '@drone-directive/protocol';
import type { ClientMessage, ErrorCode, ServerMessage, WireMapSize } from '@drone-directive/protocol';

const MAP_SIZES: readonly WireMapSize[] = ['small', 'medium', 'large'];

/**
 * A single room: holds up to two player sockets, generates the shared seed once
 * both are present, and forwards every `tick` message to the peer. No game logic,
 * no persistence beyond the room's lifetime — state is intentionally in-memory,
 * and a disconnect ends the match (no reconnection).
 */
export class Room implements DurableObject {
  private host: WebSocket | null = null;
  private guest: WebSocket | null = null;
  private roomCode = '';
  private mapSize: WireMapSize = 'medium';

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const version = Number(params.get(QueryParam.Version));
    const isHost = params.get(QueryParam.Create) === '1';
    this.roomCode = params.get(QueryParam.Room) ?? '';

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (version !== PROTOCOL_VERSION) {
      this.reject(server, 'version-mismatch', `Expected protocol v${PROTOCOL_VERSION}`);
    } else if (isHost) {
      this.acceptHost(server, params.get(QueryParam.MapSize));
    } else {
      this.acceptGuest(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptHost(ws: WebSocket, mapSize: string | null): void {
    if (this.host) {
      this.reject(ws, 'room-taken', 'That room code is already in use');
      return;
    }
    this.host = ws;
    this.mapSize = MAP_SIZES.includes(mapSize as WireMapSize) ? (mapSize as WireMapSize) : 'medium';
    this.wire(ws);
    this.send(ws, { type: 'created', roomCode: this.roomCode });
  }

  private acceptGuest(ws: WebSocket): void {
    if (!this.host) {
      this.reject(ws, 'room-not-found', 'No open room with that code');
      return;
    }
    if (this.guest) {
      this.reject(ws, 'room-full', 'That room is already full');
      return;
    }
    this.guest = ws;
    this.wire(ws);
    this.start();
  }

  /** Both sockets present: pick the shared seed and start both simulations. */
  private start(): void {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const msg: ServerMessage = { type: 'start', seed, mapSize: this.mapSize };
    this.send(this.host, msg);
    this.send(this.guest, msg);
  }

  private wire(ws: WebSocket): void {
    ws.addEventListener('message', (event) => this.relay(ws, event.data));
    ws.addEventListener('close', () => this.onClose(ws));
    ws.addEventListener('error', () => this.onClose(ws));
  }

  /** Forward a peer's `tick` verbatim; ignore anything else (the relay is dumb). */
  private relay(from: WebSocket, data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(data) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type !== 'tick') return;
    const peer = from === this.host ? this.guest : this.host;
    peer?.send(data);
  }

  private onClose(ws: WebSocket): void {
    const peer = ws === this.host ? this.guest : this.host;
    if (peer) {
      this.send(peer, { type: 'opponentLeft' });
      try {
        peer.close(1000, 'opponent-left');
      } catch {
        /* peer already closing */
      }
    }
    this.host = null;
    this.guest = null;
  }

  private reject(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, { type: 'error', code, message });
    try {
      ws.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  private send(ws: WebSocket | null, msg: ServerMessage): void {
    ws?.send(JSON.stringify(msg));
  }
}
