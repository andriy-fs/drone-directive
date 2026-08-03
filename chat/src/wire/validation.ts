import { CHAT_HISTORY_LIMIT, MAX_CHAT_TEXT_LENGTH } from '@drone-directive/protocol';
import * as v from 'valibot';
import { ChatSeat, type ChatMessage } from '../types';

/**
 * The *meaning* half of the chat boundary: what a decoded entry still has to
 * satisfy before it reaches a handler. BARE proved it is a struct with a number,
 * a tag and a string; it did not prove the number is a plausible sequence or that
 * the string is a length this UI can render.
 *
 * **Validation here is deliberately asymmetric** — the mirror image of `net`'s
 * hard rule. There, screening the local batch too is mandatory, because under
 * lockstep a filter one peer applies and the other doesn't *is* a desync. Chat
 * touches no simulation: the server is simply authoritative, the client sanitizes
 * its own optimistic echo, and a disagreement costs a re-render at worst.
 */

const entrySchema = v.object({
  // u32 on the wire; `integer` + `minValue` is what keeps a decoded-but-absurd
  // value from being used as an array index or a `since` cursor.
  seq: v.pipe(v.number(), v.integer(), v.minValue(0)),
  from: v.picklist(Object.values(ChatSeat)),
  // Non-empty: the server rejects anything that sanitizes away, so an empty one
  // is a bug or a tampered frame either way. The cap matches the sanitizer's.
  text: v.pipe(v.string(), v.nonEmpty(), v.maxLength(MAX_CHAT_TEXT_LENGTH)),
  sentAt: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

/** One entry, or `null` if it is not a usable message. */
export function parseChatEntry(raw: unknown): ChatMessage | null {
  const result = v.safeParse(entrySchema, raw);
  return result.success ? result.output : null;
}

/**
 * A whole replayed log, dropping individual entries that don't hold up rather
 * than the batch — one damaged message must not cost the conversation. The batch
 * is capped at what the server promises to keep, so a hostile object can't hand
 * this client an unbounded array to render.
 */
export function parseChatHistory(raw: unknown[]): ChatMessage[] {
  const entries: ChatMessage[] = [];
  for (const item of raw.slice(0, CHAT_HISTORY_LIMIT)) {
    const entry = parseChatEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}
