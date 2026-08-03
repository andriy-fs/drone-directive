/** The chat package's vocabulary: what a message is, what the host injects, what it calls back. */

/**
 * Which of the two seats a message came from. Const-map + union rather than a TS
 * `enum`, per this project's convention — and spelled as the strings the
 * handshake already uses, so `WIRE_CHAT_SEATS` and this are the same values.
 */
export const ChatSeat = { Host: 'host', Guest: 'guest' } as const;
export type ChatSeat = (typeof ChatSeat)[keyof typeof ChatSeat];

/**
 * One message in the log, exactly as the server numbered it. `seq` is the only
 * identity a message has: it orders the log, de-duplicates a replay, and is what
 * a reconnecting client sends back as `since`.
 */
export interface ChatMessage {
  seq: number;
  from: ChatSeat;
  text: string;
  /** Unix **seconds** (the wire carries u32, not milliseconds). */
  sentAt: number;
}

/** What the host application has to tell the chat transport about its environment. */
export interface ChatConfig {
  /**
   * WebSocket URL of the relay Worker — the same one the game uses, since the
   * chat object lives behind it on `/chat`. Injected rather than imported, for
   * the same reason as `LockstepConfig.relayUrl`: where the relay lives is the
   * application's business, not this package's.
   */
  relayUrl: string;
}

export interface ChatHandlers {
  /**
   * The log as the server holds it, delivered once per connect: everything after
   * the `since` this client asked for, plus whether the other seat is attached.
   */
  onHistory?: (entries: ChatMessage[], peerOnline: boolean) => void;
  /** A new message — either seat's, including this client's own echo. */
  onPosted?: (entry: ChatMessage) => void;
  /** The other seat attached or dropped. */
  onPresence?: (peerOnline: boolean) => void;
  /** The socket is up; anything typed before this was buffered by the caller, not by us. */
  onOpen?: () => void;
  /** The socket went away. `willRetry` is false only once the caller has disconnected for good. */
  onClose?: (willRetry: boolean) => void;
  onError?: (message: string) => void;
}
