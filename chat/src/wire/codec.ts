import { frame, MessageTag, payloadOf, tagOf } from '@drone-directive/protocol';
import * as wire from '@drone-directive/protocol/codec';
import { ChatSeat, type ChatMessage } from '../types';

/**
 * The seam between the wire and this package's vocabulary. Everything crossing
 * the chat socket is BARE (generated from `protocol/schema/messages.bare`);
 * everything above this module speaks `ChatMessage`/`ChatSeat`. Same division of
 * labour as `net/src/wire`: **BARE proves the shape**, `validation.ts` proves the
 * meaning, and decoding a frame here does not make its contents trustworthy.
 */

/** A frame from the chat object, decoded and translated. */
export type DecodedChatMessage =
  | { type: 'history'; entries: ChatMessage[]; peerOnline: boolean }
  | { type: 'posted'; entry: ChatMessage }
  | { type: 'presence'; peerOnline: boolean };

const SEAT_TO_WIRE: Record<ChatSeat, wire.ChatSeat> = {
  [ChatSeat.Host]: wire.ChatSeat.Host,
  [ChatSeat.Guest]: wire.ChatSeat.Guest,
};

const SEAT_FROM_WIRE: Record<wire.ChatSeat, ChatSeat> = {
  [wire.ChatSeat.Host]: ChatSeat.Host,
  [wire.ChatSeat.Guest]: ChatSeat.Guest,
};

/** Encode an outgoing message. The text is the client's; the `seq` and clock are the server's. */
export function encodeChatSend(text: string): Uint8Array<ArrayBuffer> {
  return frame(MessageTag.ChatSend, wire.encodeChatSendMessage({ text }));
}

/** Encode one stored entry the way the server does — used by its tests, and by the codec's own. */
export function entryToWire(entry: ChatMessage): wire.ChatEntry {
  return { seq: entry.seq, from: SEAT_TO_WIRE[entry.from], text: entry.text, sentAt: entry.sentAt };
}

export function entryFromWire(entry: wire.ChatEntry): ChatMessage {
  return { seq: entry.seq, from: SEAT_FROM_WIRE[entry.from], text: entry.text, sentAt: entry.sentAt };
}

/**
 * Decode one received frame. `null` covers everything this client does not
 * understand — an unknown tag, a game frame that wandered onto the chat socket, a
 * truncated payload. None of it is worth dropping the connection over: the socket
 * reconnects and asks for the gap anyway.
 */
export function decodeChatMessage(data: ArrayBuffer): DecodedChatMessage | null {
  const tag = tagOf(data);
  if (tag === null) return null;
  try {
    return decodePayload(tag, payloadOf(data));
  } catch {
    return null; // BareError: the bytes weren't what the tag promised
  }
}

function decodePayload(tag: MessageTag, payload: Uint8Array): DecodedChatMessage | null {
  switch (tag) {
    case MessageTag.ChatHistory: {
      const msg = wire.decodeChatHistoryMessage(payload);
      return { type: 'history', entries: msg.entries.map(entryFromWire), peerOnline: msg.peerOnline };
    }
    case MessageTag.ChatPosted:
      return { type: 'posted', entry: entryFromWire(wire.decodeChatPostedMessage(payload).entry) };
    case MessageTag.ChatPresence:
      return { type: 'presence', peerOnline: wire.decodeChatPresenceMessage(payload).peerOnline };
    default:
      // Game tags (and `ChatSend`, which only ever travels the other way) share
      // the numbering but not this socket. Unlike `net`'s decoder this one has a
      // `default`: the game's tags are a fixed set it must stay exhaustive over,
      // whereas here anything that is not one of the three above is simply not
      // ours to interpret.
      return null;
  }
}
