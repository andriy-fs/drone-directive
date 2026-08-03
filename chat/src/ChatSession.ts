import { sanitizeChatText } from '@drone-directive/protocol';
import { chatConnectUrl } from './config';
import type { ChatConfig, ChatHandlers, ChatSeat } from './types';
import { decodeChatMessage, encodeChatSend } from './wire/codec';
import { parseChatEntry, parseChatHistory } from './wire/validation';

/**
 * Backoff schedule for reconnecting, in milliseconds: doubling from a second and
 * capped, so a chat left open on a sleeping laptop costs a poll every half minute
 * rather than a thousand.
 */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/**
 * Client-side chat transport: owns the WebSocket to one `Chat` Durable Object and
 * nothing else. It is the chat half of what `LockstepSession` is to the game —
 * with one deliberate difference. A lockstep socket that drops ends the match, so
 * it never reconnects; a chat socket that drops has lost nothing, because the log
 * lives on the server. **Reconnecting is the whole point of the design**: a
 * reload, a return to the menu or a visit two days later all come back to the same
 * conversation, and every attempt carries `since = highest seq seen`, so the
 * object replies with exactly the gap instead of the whole log.
 */
export class ChatSession {
  private ws: WebSocket | null = null;
  private readonly handlers: ChatHandlers;
  private readonly config: ChatConfig;
  private chatId: string | null = null;
  private seat: ChatSeat | null = null;
  /** Highest `seq` this client has seen — the resume point on every reconnect. */
  private lastSeq = 0;
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** True between `disconnect()` and the next `connect()`: suppresses the retry. */
  private closedByCaller = true;

  constructor(handlers: ChatHandlers, config: ChatConfig) {
    this.handlers = handlers;
    this.config = config;
  }

  /** True once the socket is open and a message would actually go out. */
  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** The chat this session is attached to, or null when it is not attached to one. */
  get attachedTo(): string | null {
    return this.chatId;
  }

  /** Highest sequence number seen; the caller persists it so a later visit resumes here. */
  get resumeSeq(): number {
    return this.lastSeq;
  }

  /**
   * Attach to a chat. `sinceSeq` is what the caller has already stored locally —
   * pass it and the first `history` frame contains only what is missing; pass 0
   * (or nothing) and the object replays everything it still holds.
   */
  connect(chatId: string, seat: ChatSeat, sinceSeq = 0): void {
    if (this.chatId === chatId && this.seat === seat && this.ws) return; // already on it
    this.disconnect();
    this.chatId = chatId;
    this.seat = seat;
    this.lastSeq = Math.max(0, Math.floor(sinceSeq));
    this.closedByCaller = false;
    this.retryIndex = 0;
    this.open();
  }

  private open(): void {
    if (this.closedByCaller || !this.chatId || !this.seat) return;
    let ws: WebSocket;
    try {
      // Both `chatConnectUrl` (new URL) and `new WebSocket` throw on a malformed
      // URL — report it rather than let it escape into the caller's render.
      ws = new WebSocket(
        chatConnectUrl(this.config.relayUrl, { chatId: this.chatId, seat: this.seat, since: this.lastSeq }),
      );
    } catch {
      this.handlers.onError?.('Invalid chat server URL.');
      return;
    }
    this.ws = ws;
    // Frames are BARE, not text; without this they arrive as `Blob` and can only
    // be read asynchronously (same reason as `LockstepSession`).
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      this.retryIndex = 0; // a clean open resets the schedule
      this.handlers.onOpen?.();
    });
    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.onSocketClosed(ws));
    // Connection failures surface through the subsequent `close` event.
    ws.addEventListener('error', () => {});
  }

  private onMessage(e: MessageEvent): void {
    if (!(e.data instanceof ArrayBuffer)) return; // text on a binary protocol — not ours
    const msg = decodeChatMessage(e.data);
    if (!msg) return; // not a chat frame we understand — ignore it, don't drop the socket
    switch (msg.type) {
      case 'history': {
        // The object is trusted to be correct, not trusted to be undamaged.
        const entries = parseChatHistory(msg.entries);
        for (const entry of entries) this.lastSeq = Math.max(this.lastSeq, entry.seq);
        this.handlers.onHistory?.(entries, msg.peerOnline);
        break;
      }
      case 'posted': {
        const entry = parseChatEntry(msg.entry);
        if (!entry) return;
        // A reconnect can replay a message this client already has (the object
        // answers `since`, but a post can cross it in flight). `seq` is what makes
        // that detectable, so drop the duplicate here rather than in every caller.
        if (entry.seq <= this.lastSeq) return;
        this.lastSeq = entry.seq;
        this.handlers.onPosted?.(entry);
        break;
      }
      case 'presence':
        this.handlers.onPresence?.(msg.peerOnline);
        break;
    }
  }

  private onSocketClosed(ws: WebSocket): void {
    if (ws !== this.ws) return; // a socket we already replaced
    this.ws = null;
    const willRetry = !this.closedByCaller;
    this.handlers.onClose?.(willRetry);
    if (willRetry) this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.retryIndex, RECONNECT_DELAYS_MS.length - 1)];
    this.retryIndex += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  /**
   * Send a message. Returns the text as it will appear (the client runs the *same*
   * `sanitizeChatText` the server does, so the two cannot disagree about what was
   * said), or `null` when there was nothing to send or nowhere to send it.
   *
   * The message does not enter the log here: the server's echo carries the `seq`
   * that orders it, and inventing a placeholder number would only have to be
   * reconciled a moment later.
   */
  send(raw: string): string | null {
    const text = sanitizeChatText(raw);
    if (!text || !this.isOpen) return null;
    this.ws!.send(encodeChatSend(text));
    return text;
  }

  /** Detach for good: no retry follows this, and `connect` is the only way back. */
  disconnect(): void {
    this.closedByCaller = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.chatId = null;
    this.seat = null;
    this.retryIndex = 0;
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(1000, 'left');
      } catch {
        /* already closing */
      }
    }
  }
}
