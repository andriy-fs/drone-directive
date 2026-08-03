import { CHAT_HISTORY_LIMIT, MAX_CHAT_TEXT_LENGTH } from '@drone-directive/protocol';
import { describe, expect, it } from 'vitest';
import { ChatSeat, type ChatMessage } from '../types';
import { parseChatEntry, parseChatHistory } from './validation';

/**
 * BARE already proved the shape; these are the rules it cannot express. The
 * server is trusted to be correct, not trusted to be undamaged — a bent frame
 * that decodes should cost one message, never the conversation.
 */

const VALID: ChatMessage = { seq: 7, from: ChatSeat.Host, text: 'hold the ridge', sentAt: 1_770_000_000 };

describe('parseChatEntry', () => {
  it('accepts a well-formed entry from either seat', () => {
    expect(parseChatEntry(VALID)).toEqual(VALID);
    expect(parseChatEntry({ ...VALID, from: ChatSeat.Guest })).toEqual({ ...VALID, from: ChatSeat.Guest });
  });

  it('rejects a seat that is not one of the two', () => {
    expect(parseChatEntry({ ...VALID, from: 'spectator' })).toBeNull();
  });

  it('rejects empty text — the server drops anything that sanitizes away', () => {
    expect(parseChatEntry({ ...VALID, text: '' })).toBeNull();
  });

  it('rejects text past the cap the sanitizer enforces', () => {
    expect(parseChatEntry({ ...VALID, text: 'a'.repeat(MAX_CHAT_TEXT_LENGTH + 1) })).toBeNull();
    expect(parseChatEntry({ ...VALID, text: 'a'.repeat(MAX_CHAT_TEXT_LENGTH) })).not.toBeNull();
  });

  it('rejects a sequence number that could not have ordered anything', () => {
    expect(parseChatEntry({ ...VALID, seq: -1 })).toBeNull();
    expect(parseChatEntry({ ...VALID, seq: 1.5 })).toBeNull();
    expect(parseChatEntry({ ...VALID, seq: Number.NaN })).toBeNull();
  });

  it('rejects a nonsense timestamp', () => {
    expect(parseChatEntry({ ...VALID, sentAt: -1 })).toBeNull();
  });

  it('rejects anything that is not an entry at all', () => {
    for (const raw of [null, undefined, 'hello', 42, []]) expect(parseChatEntry(raw)).toBeNull();
  });
});

describe('parseChatHistory', () => {
  it('drops the damaged entries and keeps their neighbours', () => {
    const entries = parseChatHistory([VALID, { ...VALID, seq: 8, text: '' }, { ...VALID, seq: 9 }]);
    expect(entries.map((e) => e.seq)).toEqual([7, 9]);
  });

  it('caps a replay at what the server promises to keep', () => {
    const flood = Array.from({ length: CHAT_HISTORY_LIMIT + 50 }, (_, i) => ({ ...VALID, seq: i + 1 }));
    expect(parseChatHistory(flood)).toHaveLength(CHAT_HISTORY_LIMIT);
  });

  it('returns an empty log for an empty replay', () => {
    expect(parseChatHistory([])).toEqual([]);
  });
});
