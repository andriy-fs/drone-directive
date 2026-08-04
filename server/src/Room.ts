import {
  frame,
  MAX_AI_OPPONENTS,
  MessageTag,
  PROTOCOL_VERSION,
  QueryParam,
  RESUME_BUFFER_FRAMES,
  RESUME_GRACE_MS,
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

/** Lowercase hex of some random bytes — how a `chatId` and a `resumeToken` are spelled. */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The host names the bot count; anything absent or out of range falls back to none. */
function clampAiCount(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  return Math.min(MAX_AI_OPPONENTS, n);
}

/**
 * One of the two player seats. The socket is the changeable part: it goes away on
 * a drop and a different one takes its place on resume, while the token, the
 * pending frames and the seat's identity stay put.
 */
class Seat {
  ws: WebSocket | null = null;
  /** Issued in `start`; presenting it is what proves a reconnecting socket is this seat. */
  token = '';
  /** Frames that arrived while the socket was away, replayed in order on resume. */
  readonly missed: ArrayBuffer[] = [];
  /** True between the drop and either the resume or the end of the grace period. */
  awaiting = false;
  /** Dropped a frame for want of room: the seat can no longer be told what it missed. */
  overflowed = false;
  timer: ReturnType<typeof setTimeout> | null = null;
}

/**
 * A single room: holds up to two player sockets, generates the shared seed once
 * both are present, and forwards every `tick` message to the peer. No game logic,
 * no persistence beyond the room's lifetime — state is intentionally in-memory.
 *
 * A drop no longer ends the match outright. The seat is held for
 * `RESUME_GRACE_MS`, the frames aimed at it are kept, and the socket that comes
 * back with its `resumeToken` is given them in order. That costs the relay
 * nothing conceptually: a lockstep peer with no socket does not fall behind — the
 * other one simply stalls, exactly as it already does for lag — so re-delivery is
 * all a resume is. Content-blindness survives intact: the buffered frames are the
 * same opaque bytes the relay was already forwarding, and none of them is decoded.
 *
 * The grace period runs on a plain `setTimeout` rather than a Durable Object
 * alarm. The surviving socket keeps this object in memory for the whole window,
 * and if both sides are gone there is nobody left to notify — so the timer never
 * has to outlive the instance, and the room stays free of storage.
 *
 * A match may also seat bots, but they are not sockets: both clients simulate
 * them locally from the shared seed, so all the relay does is carry the host's
 * chosen count to the guest in `start`.
 */
export class Room implements DurableObject {
  private readonly host = new Seat();
  private readonly guest = new Seat();
  private roomCode = '';
  private mapSize: MapSize = MapSize.Medium;
  private aiCount = 0;
  /** Both seats taken and `start` sent — the point from which a seat can be resumed. */
  private started = false;

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const version = Number(params.get(QueryParam.Version));
    const isHost = params.get(QueryParam.Create) === '1';
    const resumeToken = params.get(QueryParam.Resume);
    this.roomCode = params.get(QueryParam.Room) ?? '';

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();

    if (version !== PROTOCOL_VERSION) {
      this.reject(server, ErrorCode.VersionMismatch, `Expected protocol v${PROTOCOL_VERSION}`);
    } else if (resumeToken) {
      this.acceptResume(server, resumeToken);
    } else if (isHost) {
      this.acceptHost(server, params.get(QueryParam.MapSize), params.get(QueryParam.Ai));
    } else {
      this.acceptGuest(server);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private acceptHost(ws: WebSocket, mapSize: string | null, aiCount: string | null): void {
    if (this.host.ws || this.host.awaiting) {
      this.reject(ws, ErrorCode.RoomTaken, 'That room code is already in use');
      return;
    }
    this.host.ws = ws;
    this.mapSize = WIRE_MAP_SIZES.includes(mapSize as WireMapSize) ? MAP_SIZES[mapSize as WireMapSize] : MapSize.Medium;
    this.aiCount = clampAiCount(aiCount);
    this.wire(ws, this.host);
    this.send(ws, frame(MessageTag.Created, encodeCreatedMessage({ roomCode: this.roomCode })));
  }

  private acceptGuest(ws: WebSocket): void {
    if (!this.host.ws && !this.host.awaiting) {
      this.reject(ws, ErrorCode.RoomNotFound, 'No open room with that code');
      return;
    }
    if (this.guest.ws || this.guest.awaiting) {
      this.reject(ws, ErrorCode.RoomFull, 'That room is already full');
      return;
    }
    this.guest.ws = ws;
    this.wire(ws, this.guest);
    this.start();
  }

  /**
   * A dropped seat coming back. The token names the seat as well as proving the
   * right to it, so there is nothing else to check — and everything that is not an
   * exact match on a seat still inside its grace period is refused outright rather
   * than turned into some other kind of join.
   */
  private acceptResume(ws: WebSocket, token: string): void {
    const seat = this.seatForToken(token);
    if (!seat || !seat.awaiting || seat.overflowed) {
      this.reject(ws, ErrorCode.ResumeRejected, 'That seat is no longer being held');
      return;
    }
    this.clearGrace(seat);
    seat.ws = ws;
    this.wire(ws, seat);
    // In order, and before anything new can be relayed on top of it: the peer's
    // tick stream only means anything if no tick is missing from it.
    for (const missed of seat.missed) this.send(ws, missed);
    seat.missed.length = 0;
  }

  private seatForToken(token: string): Seat | null {
    if (token && token === this.host.token) return this.host;
    if (token && token === this.guest.token) return this.guest;
    return null;
  }

  /**
   * Both sockets present: pick the shared seed and start both simulations.
   *
   * The same message carries a fresh `chatId` — 128 bits of randomness naming a
   * `Chat` Durable Object neither peer has to agree on separately. This is the
   * one instant both are told the same thing at the same time, which is the only
   * reason chat's id is issued from here. Nothing else about chat touches this
   * object: it is not relayed, not stored, and not part of the match's lifetime.
   *
   * The `resumeToken` is the one thing the two are *not* told the same: each seat
   * gets its own, which is what makes reclaiming a seat something only its holder
   * can do. So the two `start` frames are encoded separately.
   */
  private start(): void {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const chatId = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.host.token = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.guest.token = hex(crypto.getRandomValues(new Uint8Array(16)));
    this.started = true;
    for (const seat of [this.host, this.guest]) {
      const bytes = frame(
        MessageTag.Start,
        encodeStartMessage({
          seed,
          mapSize: this.mapSize,
          aiCount: this.aiCount,
          chatId,
          resumeToken: seat.token,
        }),
      );
      this.send(seat.ws, bytes);
    }
  }

  private wire(ws: WebSocket, seat: Seat): void {
    ws.addEventListener('message', (event) => this.relay(seat, event.data));
    ws.addEventListener('close', () => this.onClose(ws, seat));
    ws.addEventListener('error', () => this.onClose(ws, seat));
  }

  /**
   * Forward a peer's `tick` verbatim; ignore anything else (the relay is dumb).
   *
   * The message tag rides in the frame's leading octet, outside the BARE payload,
   * precisely so this can be a one-byte read: the relay decides what to do with a
   * frame without ever decoding one. `data` goes out exactly as it came in — the
   * relay has no opinion about what a command is and no way to form one. A frame
   * held for an absent seat is held in that same form, for the same reason.
   */
  private relay(from: Seat, data: unknown): void {
    if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return;
    if (new Uint8Array(data, 0, 1)[0] !== MessageTag.Tick) return;
    const peer = from === this.host ? this.guest : this.host;
    if (peer.awaiting) {
      this.hold(peer, data);
      return;
    }
    this.send(peer.ws, data);
  }

  private hold(seat: Seat, data: ArrayBuffer): void {
    if (seat.missed.length >= RESUME_BUFFER_FRAMES) {
      // Unreachable inside a grace period this short, and deliberately fatal if it
      // ever is reached: a stream with a hole in it desyncs the two simulations,
      // which is worse than the disconnect it was trying to paper over.
      seat.overflowed = true;
      seat.missed.length = 0;
      return;
    }
    seat.missed.push(data);
  }

  /**
   * A socket went away. Before the match starts, or once a seat has already used
   * up its grace period, that is the end of it; during a match the seat is simply
   * held open and the frames aimed at it are kept.
   */
  private onClose(ws: WebSocket, seat: Seat): void {
    if (seat.ws !== ws) return; // already replaced by a resumed socket, or already gone
    seat.ws = null;
    if (!this.started) {
      this.endMatch(seat);
      return;
    }
    seat.awaiting = true;
    seat.timer = setTimeout(() => {
      seat.timer = null;
      this.endMatch(seat);
    }, RESUME_GRACE_MS);
  }

  /** The match is over: tell whoever is still connected, and let the room go. */
  private endMatch(lost: Seat): void {
    const peer = lost === this.host ? this.guest : this.host;
    if (peer.ws) {
      // Carries nothing, so the frame is the tag byte alone.
      this.send(peer.ws, frame(MessageTag.OpponentLeft));
      try {
        peer.ws.close(1000, 'opponent-left');
      } catch {
        /* peer already closing */
      }
    }
    for (const seat of [this.host, this.guest]) {
      this.clearGrace(seat);
      seat.ws = null;
      seat.token = '';
      seat.missed.length = 0;
      seat.overflowed = false;
    }
    this.started = false;
  }

  private clearGrace(seat: Seat): void {
    seat.awaiting = false;
    if (seat.timer !== null) {
      clearTimeout(seat.timer);
      seat.timer = null;
    }
  }

  private reject(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, frame(MessageTag.Error, encodeErrorMessage({ code, message })));
    try {
      ws.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  private send(ws: WebSocket | null, frameBytes: Uint8Array | ArrayBuffer): void {
    ws?.send(frameBytes);
  }
}
