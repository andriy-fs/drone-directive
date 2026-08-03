import { CHAT_RETENTION_MS } from '@drone-directive/protocol';
import { ChatSeat } from '@drone-directive/chat';
import { storage } from '../utils/storage';

/**
 * The chats this browser knows about. The server holds the conversation; this
 * holds the *addresses* of the conversations — which is what actually survives an
 * F5. Without it a reload has no `chatId` to reconnect with, and the log is
 * unreachable even though the relay still has every word of it.
 *
 * Kept deliberately small: an id, a seat, the room code it came from (only so the
 * player can tell two chats apart) and where the client left off.
 */

const STORAGE_KEY = 'dd:chats';

/** Whether a new message makes a sound. Persisted separately — it is a preference, not a chat. */
const SOUND_KEY = 'dd:chatSound';

/** Most chats remembered at once — older ones fall off before the list can grow unbounded. */
const MAX_KNOWN_CHATS = 20;

export interface KnownChat {
  chatId: string;
  seat: ChatSeat;
  /** The room code the match was played in; shown so two chats are distinguishable. */
  roomCode: string | null;
  /** Highest `seq` this browser has seen — the resume point on the next connect. */
  lastSeq: number;
  /** Epoch ms of the last activity, used to prune past the server's own retention. */
  lastActivity: number;
}

function isKnownChat(value: unknown): value is KnownChat {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<KnownChat>;
  return (
    typeof c.chatId === 'string' &&
    c.chatId.length > 0 &&
    (c.seat === ChatSeat.Host || c.seat === ChatSeat.Guest) &&
    typeof c.lastSeq === 'number' &&
    typeof c.lastActivity === 'number'
  );
}

/**
 * Every chat this browser still has a live address for, newest first. Anything
 * past the server's retention is dropped on read: the object behind it has
 * erased itself, so offering it would only open an empty conversation.
 */
export function loadKnownChats(): KnownChat[] {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // hand-edited or written by an older build — start over
  }
  if (!Array.isArray(parsed)) return [];
  const cutoff = Date.now() - CHAT_RETENTION_MS;
  return parsed
    .filter(isKnownChat)
    .filter((c) => c.lastActivity > cutoff)
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

/** The most recent chat still worth reconnecting to, or null. */
export function latestKnownChat(): KnownChat | null {
  return loadKnownChats()[0] ?? null;
}

/**
 * Record (or refresh) a chat. Merges rather than overwrites so a caller that only
 * knows the new `lastSeq` doesn't have to carry the room code around with it.
 */
export function rememberChat(patch: Pick<KnownChat, 'chatId'> & Partial<KnownChat>): void {
  const known = loadKnownChats();
  const existing = known.find((c) => c.chatId === patch.chatId);
  const merged: KnownChat = {
    chatId: patch.chatId,
    seat: patch.seat ?? existing?.seat ?? ChatSeat.Host,
    roomCode: patch.roomCode ?? existing?.roomCode ?? null,
    // Never move the resume point backwards: a stale caller must not make this
    // browser re-download messages it has already shown.
    lastSeq: Math.max(patch.lastSeq ?? 0, existing?.lastSeq ?? 0),
    lastActivity: patch.lastActivity ?? Date.now(),
  };
  const next = [merged, ...known.filter((c) => c.chatId !== patch.chatId)].slice(0, MAX_KNOWN_CHATS);
  write(next);
}

/** Forget one chat (the player closed it for good). */
export function forgetChat(chatId: string): void {
  write(loadKnownChats().filter((c) => c.chatId !== chatId));
}

function write(chats: KnownChat[]): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(chats));
}

/**
 * Does a new message make a sound? On by default — a chat the player cannot hear
 * while they are looking at the battle is most of the way to no chat at all — but
 * the choice is remembered, because someone who turned it off once meant it.
 */
export function loadChatSound(): boolean {
  return storage.getItem(SOUND_KEY) !== 'off';
}

export function saveChatSound(on: boolean): void {
  storage.setItem(SOUND_KEY, on ? 'on' : 'off');
}
