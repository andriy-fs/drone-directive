import { ChatSession, type ChatMessage, type ChatSeat } from '@drone-directive/chat';
import { sfx } from '../pixi/audio/sfx';
import { useGameStore } from '../store/gameStore';
import { chatConfig } from './chatConfig';
import { forgetChat, latestKnownChat, rememberChat, saveChatSound } from './chatStorage';

/**
 * The app-level owner of the chat socket: one `ChatSession`, pushed into the
 * store. Exactly what `GameApp` is to `LockstepSession` — with one structural
 * difference that is the whole reason it is a module of its own rather than
 * another field on `GameApp`.
 *
 * **Chat must not die with the match.** `GameApp` tears its session down on
 * `endOnline`/`leaveOnlineIfAny`, and it is itself unmounted with the canvas. A
 * chat that lived there would end when the opponent left — the exact moment the
 * players most want to say "gg". So it lives here, outside `pixi/`, as a module
 * singleton with a lifetime of its own: attached when a match starts, restored
 * from `localStorage` on the next page load, and detached only when the player
 * closes the conversation for good.
 *
 * It is app glue, not a layer: no renderer, no engine, no React.
 */

let session: ChatSession | null = null;

/**
 * Highest `seq` this browser had already read before the current attach.
 * Everything the opponent sent above it is unread — that is what turns a
 * conversation left open two days ago back into a badge, rather than a panel that
 * silently fills with messages nobody was told about.
 */
let readUpTo = 0;

/** Where the store's slice is written from — nothing else may touch these fields. */
const store = () => useGameStore.getState();

function ensureSession(): ChatSession {
  session ??= new ChatSession(
    {
      onOpen: () => store().setChat({ connected: true, error: null }),
      onHistory: (entries, peerOnline) => {
        const unread = store().chat.unread + unreadIn(entries);
        store().mergeChatHistory(entries);
        store().setChat({ peerOnline, unread });
        persist(entries);
      },
      onPosted: (entry) => {
        // Only the opponent's messages make a sound, and only live ones: a
        // reconnect replays through `onHistory`, and a burst of pings for a
        // conversation the player already had would be the worst of both.
        if (entry.from !== store().chat.seat && store().chat.soundOn) sfx.chatMessage();
        store().appendChatMessage(entry);
        persist([entry]);
      },
      onPresence: (peerOnline) => store().setChat({ peerOnline }),
      // Losing the socket loses nothing — the log is on the server and the session
      // is already reconnecting. `peerOnline` is left alone rather than guessed
      // at: the panel only shows the presence dot while `connected`.
      onClose: () => store().setChat({ connected: false }),
      onError: (message) => store().setChat({ error: message }),
    },
    chatConfig,
  );
  return session;
}

/**
 * Note how far this browser has got, and keep the chat's address alive. `lastSeq`
 * is what makes a badge possible across a page load: anything above it that the
 * opponent sent is something this player has not seen yet.
 */
function persist(entries: ChatMessage[]): void {
  const { chatId } = store().chat;
  if (!chatId || entries.length === 0) return;
  rememberChat({ chatId, lastSeq: Math.max(...entries.map((e) => e.seq)), lastActivity: Date.now() });
}

/**
 * A match has started: this is the chat both peers were just handed. Connects
 * immediately (rather than on first open) so a message that arrives while the
 * panel is collapsed still shows up as an unread badge.
 */
export function attachChat(chatId: string, seat: ChatSeat, roomCode: string | null): void {
  const current = store().chat;
  if (current.chatId !== chatId) {
    // A different conversation: nothing from the old one belongs on screen, and
    // its read point says nothing about this one.
    store().setChat({ chatId, seat, roomCode, messages: [], unread: 0, error: null, peerOnline: false });
    readUpTo = 0;
  } else {
    store().setChat({ seat, roomCode, error: null });
  }
  rememberChat({ chatId, seat, roomCode, lastActivity: Date.now() });
  connect(chatId, seat);
}

/**
 * Re-attach to the most recent chat this browser knows about. Called once at
 * startup: the server still holds the conversation for a week, and this is what
 * turns that into a chat the player can actually reach after a reload.
 */
export function restoreChat(): void {
  if (store().chat.chatId) return; // a live match already attached one
  const known = latestKnownChat();
  if (!known) return;
  store().setChat({ chatId: known.chatId, seat: known.seat, roomCode: known.roomCode, messages: [], unread: 0 });
  // What the player had already read last time — captured *before* connecting,
  // because the first history frame overwrites it.
  readUpTo = known.lastSeq;
  connect(known.chatId, known.seat);
}

function connect(chatId: string, seat: ChatSeat): void {
  // `since` is what is already **on screen**, not what was once received: after a
  // reload the panel is empty, so the whole log (up to what the server keeps) has
  // to come back. Mid-session reconnects are the session's own business — it
  // re-sends the highest seq it has seen, and gets exactly the gap.
  const onScreen = store().chat.messages;
  ensureSession().connect(chatId, seat, onScreen.length > 0 ? onScreen[onScreen.length - 1].seq : 0);
}

/** Unread count for a replayed log: the opponent's messages past the last read point. */
function unreadIn(entries: ChatMessage[]): number {
  const { seat, open } = store().chat;
  if (open) return 0;
  return entries.filter((e) => e.seq > readUpTo && e.from !== seat).length;
}

/** Silence (or restore) the ping for arriving messages. Remembered across visits. */
export function setChatSound(on: boolean): void {
  saveChatSound(on);
  store().setChat({ soundOn: on });
  // Play the thing being switched on, so the choice is audible rather than a
  // promise about the next message.
  if (on) sfx.chatMessage();
}

/** Expand the panel. Reading it is what clears the badge. */
export function openChat(): void {
  // Browsers keep an AudioContext suspended until a user gesture, and after a
  // reload the player may never have pressed Start — this click is the gesture
  // that lets the first notification actually be heard.
  sfx.resume();
  store().setChat({ open: true });
  store().markChatRead();
  const messages = store().chat.messages;
  readUpTo = messages.length > 0 ? messages[messages.length - 1].seq : readUpTo;
}

/** Collapse the panel. The socket stays up — the badge is the point of leaving it open. */
export function closeChat(): void {
  store().setChat({ open: false });
}

/**
 * Send a message. The text goes through the same `sanitizeChatText` the server
 * runs, so what the sender sees is what the log will store; the message itself
 * only appears once the server echoes it back with the `seq` that orders it.
 *
 * Returns false when there was nothing to send or nowhere to send it — the caller
 * uses that to decide whether to clear the input.
 */
export function sendChat(text: string): boolean {
  return session?.send(text) != null;
}

/**
 * Leave the conversation for good: drop the socket, forget the address, clear the
 * slice. The server keeps its copy until retention expires — this is the local
 * half only, which is why it is separate from anything the match does.
 */
export function dismissChat(): void {
  const { chatId } = store().chat;
  if (chatId) forgetChat(chatId);
  session?.disconnect();
  session = null;
  readUpTo = 0;
  store().setChat({
    open: false,
    chatId: null,
    seat: null,
    roomCode: null,
    connected: false,
    peerOnline: false,
    messages: [],
    unread: 0,
    error: null,
  });
}
