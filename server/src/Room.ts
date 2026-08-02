import {
  frame,
  MAX_AI_OPPONENTS,
  MessageTag,
  PROTOCOL_VERSION,
  QueryParam,
  WIRE_MAP_SIZES,
} from '@drone-directive/protocol';
import type { WireMapSize } from '@drone-directive/protocol';
import {
  encodeCreatedMessage,
  encodeErrorMessage,
  encodeStartMessage,
  ErrorCode,
  MapSize,
} from '@drone-directive/protocol/codec';

/**
 * The `mapSize` query param is text (it precedes any message), so the one piece of
 * input validation the relay does is still a string lookup — but what it forwards
 * is the schema's tag.
 */
const MAP_SIZES: Record<WireMapSize, MapSize> = {
  small: MapSize.Small,
  medium: MapSize.Medium,
  large: MapSize.Large,
};

/** The host names the bot count; anything absent or out of range falls back to none. */
function clampAiCount(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(MAX_AI_OPPONENTS, n);
}

/**
 * A single room: holds up to two player sockets, generates the shared seed once
 * both are present, and forwards every `tick` message to the peer. No game logic,
 * no persistence beyond the room's lifetime — state is intentionally in-memory,
 * and a disconnect ends the match (no reconnection).
 *
 * A match may also seat bots, but they are not sockets: both clients simulate
 * them locally from the shared seed, so all the relay does is carry the host's
 * chosen count to the guest in `start`.
 */
export class Room implements DurableObject {
  private host: WebSocket | null = null;
  private guest: WebSocket | null = null;
  private roomCode = '';
  private mapSize: MapSize = MapSize.Medium;
  private aiCount = 0;

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const version = Number(params.get(QueryParam.Version));
    const isHost = params.get(QueryParam.Create) === '1';
    this.roomCode = params.get(QueryParam.Room) ?? '';

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (version !== PROTOCOL_VERSION) {
      this.reject(server, ErrorCode.VersionMismatch, `Expected protocol v${PROTOCOL_VERSION}`);
    } else if (isHost) {
      this.acceptHost(server, params.get(QueryParam.MapSize), params.get(QueryParam.Ai));
    } else {
      this.acceptGuest(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptHost(ws: WebSocket, mapSize: string | null, aiCount: string | null): void {
    if (this.host) {
      this.reject(ws, ErrorCode.RoomTaken, 'That room code is already in use');
      return;
    }
    this.host = ws;
    this.mapSize = WIRE_MAP_SIZES.includes(mapSize as WireMapSize) ? MAP_SIZES[mapSize as WireMapSize] : MapSize.Medium;
    this.aiCount = clampAiCount(aiCount);
    this.wire(ws);
    this.send(ws, frame(MessageTag.Created, encodeCreatedMessage({ roomCode: this.roomCode })));
  }

  private acceptGuest(ws: WebSocket): void {
    if (!this.host) {
      this.reject(ws, ErrorCode.RoomNotFound, 'No open room with that code');
      return;
    }
    if (this.guest) {
      this.reject(ws, ErrorCode.RoomFull, 'That room is already full');
      return;
    }
    this.guest = ws;
    this.wire(ws);
    this.start();
  }

  /** Both sockets present: pick the shared seed and start both simulations. */
  private start(): void {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const bytes = frame(MessageTag.Start, encodeStartMessage({ seed, mapSize: this.mapSize, aiCount: this.aiCount }));
    this.send(this.host, bytes);
    this.send(this.guest, bytes);
  }

  private wire(ws: WebSocket): void {
    ws.addEventListener('message', (event) => this.relay(ws, event.data));
    ws.addEventListener('close', () => this.onClose(ws));
    ws.addEventListener('error', () => this.onClose(ws));
  }

  /**
   * Forward a peer's `tick` verbatim; ignore anything else (the relay is dumb).
   *
   * The message tag rides in the frame's leading octet, outside the BARE payload,
   * precisely so this can be a one-byte read: the relay decides what to do with a
   * frame without ever decoding one. `data` goes out exactly as it came in — the
   * relay has no opinion about what a command is and no way to form one.
   */
  private relay(from: WebSocket, data: unknown): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return;
    if (new Uint8Array(data, 0, 1)[0] !== MessageTag.Tick) return;
    const peer = from === this.host ? this.guest : this.host;
    peer?.send(data);
  }

  private onClose(ws: WebSocket): void {
    const peer = ws === this.host ? this.guest : this.host;
    if (peer) {
      // Carries nothing, so the frame is the tag byte alone.
      this.send(peer, frame(MessageTag.OpponentLeft));
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
    this.send(ws, frame(MessageTag.Error, encodeErrorMessage({ code, message })));
    try {
      ws.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  private send(ws: WebSocket | null, frameBytes: Uint8Array): void {
    ws?.send(frameBytes);
  }
}
