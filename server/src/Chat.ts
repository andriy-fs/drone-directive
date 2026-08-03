import {
  CHAT_HISTORY_LIMIT,
  CHAT_RATE_LIMIT,
  CHAT_RETENTION_MS,
  frame,
  MAX_CHAT_TEXT_LENGTH,
  MessageTag,
  PROTOCOL_VERSION,
  QueryParam,
  sanitizeChatText,
  WIRE_CHAT_SEATS,
} from '@drone-directive/protocol';
import type { WireChatSeat } from '@drone-directive/protocol';
import {
  ChatSeat,
  decodeChatSendMessage,
  encodeChatHistoryMessage,
  encodeChatPostedMessage,
  encodeChatPresenceMessage,
  encodeErrorMessage,
  ErrorCode,
  type ChatEntry,
} from '@drone-directive/protocol/codec';

/** The seat tag, both as a hibernation tag and as the integer stored in SQL. */
const SEAT_TAG: Record<WireChatSeat, ChatSeat> = { host: ChatSeat.Host, guest: ChatSeat.Guest };
const SEAT_COLUMN: Record<WireChatSeat, number> = { host: 0, guest: 1 };
const SEAT_FROM_COLUMN: ChatSeat[] = [ChatSeat.Host, ChatSeat.Guest];

/** One socket's send budget, kept on the socket so it survives hibernation. */
interface Attachment {
  seat: WireChatSeat;
  windowStart: number;
  count: number;
}

/** A stored message, as SQLite hands it back. */
interface Row extends Record<string, string | number | ArrayBuffer | null> {
  seq: number;
  seat: number;
  text: string;
  sent_at: number;
}

/**
 * The chat for one match, and the second Durable Object in this Worker. It shares
 * nothing with `Room` but the protocol: a different socket, a different address
 * (a relay-issued opaque `chatId` rather than a 4-character room code), and a
 * different lifetime — a chat outlives the match that created it by up to
 * `CHAT_RETENTION_MS`, which is the entire point of it living here rather than in
 * the two clients.
 *
 * **It decodes what it is sent, and `Room` does not.** That is not an
 * inconsistency: `Room`'s content-blindness is about relaying a lockstep tick it
 * has no business understanding, whereas this object has to read a message to
 * number it, store it and cap the log. Nothing it decodes is a simulation input.
 *
 * **Hibernatable from the first line.** Sockets are accepted through
 * `ctx.acceptWebSocket` (not `server.accept()`), with the seat as the hibernation
 * tag, so `ctx.getWebSockets('host'|'guest')` finds the peer without any
 * in-memory state to lose. That is what lets a chat sit idle for a week at no
 * cost — and it is why the rate-limit counters live in the socket's attachment
 * rather than in a field.
 */
export class Chat implements DurableObject {
  private readonly ctx: DurableObjectState;

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
    // Before any request is served: a hibernated object wakes with its SQL intact,
    // but a brand-new one (or one just erased by `alarm`) has no table yet.
    void this.ctx.blockConcurrencyWhile(async () => this.ensureSchema());
  }

  async fetch(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const version = Number(params.get(QueryParam.Version));
    const rawSeat = params.get(QueryParam.Seat);
    const since = Math.max(0, Math.floor(Number(params.get(QueryParam.Since))) || 0);

    const { 0: client, 1: server } = new WebSocketPair();

    if (version !== PROTOCOL_VERSION) {
      // The rejected socket never joins the conversation, so it is accepted the
      // plain way and closed — hibernation would only complicate a one-frame life.
      this.reject(server, ErrorCode.VersionMismatch, `Expected protocol v${PROTOCOL_VERSION}`);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!isWireSeat(rawSeat)) {
      this.reject(server, ErrorCode.BadMessage, 'A chat socket must name a seat');
      return new Response(null, { status: 101, webSocket: client });
    }

    // The seat doubles as the hibernation tag: it is how the peer is found later,
    // with no in-memory map to survive the object going to sleep.
    this.ctx.acceptWebSocket(server, [rawSeat]);
    server.serializeAttachment({ seat: rawSeat, windowStart: 0, count: 0 } satisfies Attachment);

    const peerOnline = this.socketsFor(otherSeat(rawSeat)).length > 0;
    server.send(frame(MessageTag.ChatHistory, encodeChatHistoryMessage({ entries: this.history(since), peerOnline })));
    // The other seat now has someone to talk to.
    this.broadcastPresence(otherSeat(rawSeat), true);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A message from one of the two seats. Everything the client could have got
   * wrong is re-decided here — the client's own `sanitizeChatText` exists so the
   * sender sees what the log will store, not so this can trust it.
   */
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message === 'string' || message.byteLength === 0) return; // text on a binary protocol
    if (new Uint8Array(message, 0, 1)[0] !== MessageTag.ChatSend) return; // not a tag this object answers

    const attachment = this.attachmentOf(ws);
    if (!attachment) return;

    let text: string;
    try {
      text = sanitizeChatText(decodeChatSendMessage(new Uint8Array(message, 1)).text);
    } catch {
      return; // BareError: the bytes weren't what the tag promised
    }
    // Empty means it sanitized away to nothing (whitespace, control codes only).
    if (!text || !this.spendBudget(ws, attachment)) return;

    const entry = this.append(attachment.seat, text);
    // Both sockets, sender included: its own echo is what tells it the `seq` its
    // message got, which is what orders the log and drives the next resume point.
    const bytes = frame(MessageTag.ChatPosted, encodeChatPostedMessage({ entry }));
    for (const seat of WIRE_CHAT_SEATS) for (const peer of this.socketsFor(seat)) safeSend(peer, bytes);

    // Retention runs from the *last* message, so every post pushes the erase out.
    void this.ctx.storage.setAlarm(Date.now() + CHAT_RETENTION_MS);
  }

  webSocketClose(ws: WebSocket): void {
    this.onGone(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.onGone(ws);
  }

  /** Retention expired: erase the conversation. Also drops the pending alarm. */
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    // `deleteAll` takes the table with it; a socket that is still attached would
    // otherwise fail on its next send.
    this.ensureSchema();
  }

  // -------------------------------------------------------------------------
  // Presence
  // -------------------------------------------------------------------------

  /**
   * A seat's socket went away. The seat counts as offline only once it has no
   * socket left — `webSocketClose` fires with the closing socket still listed, so
   * it is excluded explicitly rather than assumed gone.
   */
  private onGone(ws: WebSocket): void {
    const seat = this.attachmentOf(ws)?.seat;
    if (!seat) return;
    const stillHere = this.socketsFor(seat).some((s) => s !== ws);
    if (!stillHere) this.broadcastPresence(otherSeat(seat), false);
  }

  /** Tell `seat` whether the other one is around. */
  private broadcastPresence(seat: WireChatSeat, peerOnline: boolean): void {
    const bytes = frame(MessageTag.ChatPresence, encodeChatPresenceMessage({ peerOnline }));
    for (const ws of this.socketsFor(seat)) safeSend(ws, bytes);
  }

  private socketsFor(seat: WireChatSeat): WebSocket[] {
    return this.ctx.getWebSockets(seat);
  }

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------

  /**
   * Spend one message from this socket's budget, `false` if it is exhausted.
   *
   * The counter lives in the socket's attachment, not in a field: an in-memory
   * counter is lost the moment the object hibernates, which is a flood window
   * anyone could open just by waiting.
   */
  private spendBudget(ws: WebSocket, attachment: Attachment): boolean {
    const now = Date.now();
    const fresh = now - attachment.windowStart >= CHAT_RATE_LIMIT.windowMs;
    const windowStart = fresh ? now : attachment.windowStart;
    const count = (fresh ? 0 : attachment.count) + 1;
    if (count > CHAT_RATE_LIMIT.messages) return false;
    ws.serializeAttachment({ seat: attachment.seat, windowStart, count } satisfies Attachment);
    return true;
  }

  private attachmentOf(ws: WebSocket): Attachment | null {
    const raw: unknown = ws.deserializeAttachment();
    if (!raw || typeof raw !== 'object') return null;
    const { seat, windowStart, count } = raw as Partial<Attachment>;
    if (!isWireSeat(seat ?? null)) return null;
    return { seat: seat!, windowStart: Number(windowStart) || 0, count: Number(count) || 0 };
  }

  // -------------------------------------------------------------------------
  // Storage
  // -------------------------------------------------------------------------

  /**
   * Turn a socket away before it ever joins: one error frame, then closed. It is
   * accepted the plain way (`server.accept()`), never handed to the hibernation
   * manager — there is nothing to keep it alive for.
   */
  private reject(ws: WebSocket, code: ErrorCode, message: string): void {
    ws.accept();
    safeSend(ws, frame(MessageTag.Error, encodeErrorMessage({ code, message })));
    try {
      ws.close(1008, code);
    } catch {
      /* already closing */
    }
  }

  private ensureSchema(): void {
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS messages (
         seq INTEGER PRIMARY KEY,
         seat INTEGER NOT NULL,
         text TEXT NOT NULL,
         sent_at INTEGER NOT NULL
       )`,
    );
  }

  /** Everything after `since`, oldest first, never more than the object keeps. */
  private history(since: number): ChatEntry[] {
    const rows = this.ctx.storage.sql
      .exec<Row>(
        'SELECT seq, seat, text, sent_at FROM messages WHERE seq > ? ORDER BY seq LIMIT ?',
        since,
        CHAT_HISTORY_LIMIT,
      )
      .toArray();
    return rows.map(toEntry);
  }

  /** Number, timestamp and store one message, then drop whatever fell off the end. */
  private append(seat: WireChatSeat, text: string): ChatEntry {
    const sql = this.ctx.storage.sql;
    // `MAX(seq)` and not a row count: pruning removes the oldest rows, so the
    // highest number ever issued is still the highest one present.
    const highest = sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM messages').one().seq ?? 0;
    const seq = highest + 1;
    const sentAt = Math.floor(Date.now() / 1000);
    sql.exec(
      'INSERT INTO messages (seq, seat, text, sent_at) VALUES (?, ?, ?, ?)',
      seq,
      SEAT_COLUMN[seat],
      text.slice(0, MAX_CHAT_TEXT_LENGTH),
      sentAt,
    );
    sql.exec('DELETE FROM messages WHERE seq <= ?', seq - CHAT_HISTORY_LIMIT);
    return { seq, from: SEAT_TAG[seat], text, sentAt };
  }
}

function toEntry(row: Row): ChatEntry {
  return { seq: row.seq, from: SEAT_FROM_COLUMN[row.seat] ?? ChatSeat.Host, text: row.text, sentAt: row.sent_at };
}

function isWireSeat(value: string | null | undefined): value is WireChatSeat {
  return WIRE_CHAT_SEATS.includes(value as WireChatSeat);
}

function otherSeat(seat: WireChatSeat): WireChatSeat {
  return seat === 'host' ? 'guest' : 'host';
}

/** A socket can be closing while it is still in `getWebSockets`; a broadcast must not die on that. */
function safeSend(ws: WebSocket, bytes: Uint8Array): void {
  try {
    ws.send(bytes);
  } catch {
    /* already closing */
  }
}
