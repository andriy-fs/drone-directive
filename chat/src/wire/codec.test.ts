import {
  CHAT_ID_LENGTH,
  frame,
  MAX_CHAT_TEXT_LENGTH,
  MessageTag,
  sanitizeChatText,
  tagOf,
} from '@drone-directive/protocol';
import {
  encodeChatHistoryMessage,
  encodeChatPostedMessage,
  encodeChatPresenceMessage,
  decodeChatSendMessage,
} from '@drone-directive/protocol/codec';
import { describe, expect, it } from 'vitest';
import { chatConnectUrl } from '../config';
import { ChatSeat, type ChatMessage } from '../types';
import { decodeChatMessage, encodeChatSend, entryToWire } from './codec';

/**
 * Same argument as `net`'s codec test: a binary protocol fails silently when it
 * fails at all — a field written in the wrong order still decodes, just into
 * different values. So every message goes out and comes back, and the assertion
 * is on the domain object, not the bytes.
 */

const ENTRY: ChatMessage = { seq: 3, from: ChatSeat.Guest, text: 'gg wp', sentAt: 1_770_000_000 };

/** The socket hands back an `ArrayBuffer`; encoders produce a view into a larger one. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('chat codec', () => {
  it('round-trips a posted entry, seat and all', () => {
    const bytes = frame(MessageTag.ChatPosted, encodeChatPostedMessage({ entry: entryToWire(ENTRY) }));
    expect(decodeChatMessage(toArrayBuffer(bytes))).toEqual({ type: 'posted', entry: ENTRY });
  });

  it('round-trips history with both seats and the presence flag', () => {
    const entries: ChatMessage[] = [{ seq: 1, from: ChatSeat.Host, text: 'hello', sentAt: 1_770_000_001 }, ENTRY];
    const payload = encodeChatHistoryMessage({ entries: entries.map(entryToWire), peerOnline: true });
    const decoded = decodeChatMessage(toArrayBuffer(frame(MessageTag.ChatHistory, payload)));
    expect(decoded).toEqual({ type: 'history', entries, peerOnline: true });
  });

  it('round-trips an empty history — a fresh chat is a real state, not a failure', () => {
    const payload = encodeChatHistoryMessage({ entries: [], peerOnline: false });
    expect(decodeChatMessage(toArrayBuffer(frame(MessageTag.ChatHistory, payload)))).toEqual({
      type: 'history',
      entries: [],
      peerOnline: false,
    });
  });

  it('round-trips presence', () => {
    const payload = encodeChatPresenceMessage({ peerOnline: false });
    expect(decodeChatMessage(toArrayBuffer(frame(MessageTag.ChatPresence, payload)))).toEqual({
      type: 'presence',
      peerOnline: false,
    });
  });

  it('encodes a send under its own tag, decodable by the server', () => {
    const bytes = encodeChatSend('hello there');
    expect(tagOf(toArrayBuffer(bytes))).toBe(MessageTag.ChatSend);
    expect(decodeChatSendMessage(bytes.slice(1)).text).toBe('hello there');
  });

  it('ignores a game frame that arrives on the chat socket', () => {
    for (const tag of [MessageTag.Tick, MessageTag.Created, MessageTag.Start, MessageTag.Error]) {
      expect(decodeChatMessage(toArrayBuffer(frame(tag, new Uint8Array([0]))))).toBeNull();
    }
  });

  it('returns null for truncated bytes rather than throwing at the socket', () => {
    expect(decodeChatMessage(toArrayBuffer(frame(MessageTag.ChatPosted, new Uint8Array([0xff]))))).toBeNull();
    expect(decodeChatMessage(new ArrayBuffer(0))).toBeNull();
  });
});

describe('sanitizeChatText', () => {
  it('leaves ordinary text alone', () => {
    expect(sanitizeChatText('rush their base, I have missiles')).toBe('rush their base, I have missiles');
  });

  it('strips control characters, which a single-line log would render as nothing', () => {
    expect(sanitizeChatText('ok\u0000\u0007 then\u001b')).toBe('ok then');
  });

  it('strips bidi overrides, which reorder text without changing it', () => {
    expect(sanitizeChatText('gg\u202ewp\u202c')).toBe('ggwp');
  });

  it('collapses whitespace runs and newlines into single spaces', () => {
    expect(sanitizeChatText('  too   many\n\nblanks\t ')).toBe('too many blanks');
  });

  it('rejects whitespace-only input by sanitizing it to the empty string', () => {
    expect(sanitizeChatText('   \n\t  ')).toBe('');
    expect(sanitizeChatText('\u0000\u202e')).toBe('');
  });

  it('truncates over-length text instead of rejecting it', () => {
    const long = 'a'.repeat(MAX_CHAT_TEXT_LENGTH + 200);
    expect(sanitizeChatText(long)).toHaveLength(MAX_CHAT_TEXT_LENGTH);
  });

  it('never truncates into the middle of a surrogate pair', () => {
    // An odd-length prefix puts the cut exactly between the two halves of the emoji.
    const text = 'a'.repeat(MAX_CHAT_TEXT_LENGTH - 1) + '😀';
    const out = sanitizeChatText(text);
    expect(out).toHaveLength(MAX_CHAT_TEXT_LENGTH - 1);
    expect([...out].every((c) => c === 'a')).toBe(true);
  });

  it('is idempotent — the client and the server must reach the same string', () => {
    const raw = '  hi\u0000  there\u202e  ';
    expect(sanitizeChatText(sanitizeChatText(raw))).toBe(sanitizeChatText(raw));
  });
});

describe('chatConnectUrl', () => {
  const chatId = 'f'.repeat(CHAT_ID_LENGTH);

  it('targets the chat path with the seat and the version', () => {
    const url = new URL(chatConnectUrl('ws://localhost:8787', { chatId, seat: ChatSeat.Host }));
    expect(url.pathname).toBe('/chat');
    expect(url.searchParams.get('chat')).toBe(chatId);
    expect(url.searchParams.get('seat')).toBe('host');
    expect(url.searchParams.get('v')).not.toBeNull();
  });

  it('omits `since` at the start of a log and carries it on a resume', () => {
    const fresh = new URL(chatConnectUrl('ws://r/', { chatId, seat: ChatSeat.Guest }));
    expect(fresh.searchParams.get('since')).toBeNull();
    const resumed = new URL(chatConnectUrl('ws://r/', { chatId, seat: ChatSeat.Guest, since: 42 }));
    expect(resumed.searchParams.get('since')).toBe('42');
  });
});
