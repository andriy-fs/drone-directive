import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@drone-directive/chat';
import { closeChat, dismissChat, openChat, sendChat, setChatSound } from '../../chat/chatBridge';
import { useT, type T } from '../../i18n';
import { useGameStore } from '../../store/gameStore';
import { selectChat } from '../../store/selectors';
import { Button } from '../common/Button';
import { BellIcon, BellOffIcon, MessageSquareIcon, SendIcon, XIcon } from '../common/icons';

/**
 * Chat with the online opponent: a floating panel over the canvas, collapsed to a
 * button with an unread badge.
 *
 * **Mounted outside `App`'s `inMatch` guard, on purpose.** The conversation
 * outlives the match — it survives the opponent leaving, the return to the menu,
 * and (through `chatStorage` + `restoreChat`) a reload or a visit days later. A
 * panel that only existed while a match ran would take the chat down with it at
 * the exact moment the players want to talk.
 *
 * Everything it does goes through `chat/chatBridge`, never the store directly:
 * opening the panel may also have to open a socket, and the store has no business
 * knowing what a socket is.
 */
export function ChatPanel() {
  const t = useT();
  const chat = useGameStore(selectChat);

  if (!chat.chatId) return null;

  return chat.open ? <ExpandedChat t={t} /> : <CollapsedChat t={t} unread={chat.unread} />;
}

function CollapsedChat({ t, unread }: { t: T; unread: number }) {
  return (
    <Button className="chat-launcher" onClick={openChat} title={t('chat', 'open')} aria-label={t('chat', 'open')}>
      <MessageSquareIcon size={18} aria-hidden />
      {unread > 0 && <span className="chat-launcher__badge">{unread > 99 ? '99+' : unread}</span>}
    </Button>
  );
}

function ExpandedChat({ t }: { t: T }) {
  const chat = useGameStore(selectChat);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Stick to the newest message. Runs on every log change rather than on mount:
  // messages arrive while the panel is already open, which is the common case.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.messages]);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = () => {
    // The bridge sanitizes with the *server's* function, so a draft that is only
    // whitespace or control characters is refused here exactly as it would be
    // refused there — and the draft stays put rather than vanishing silently.
    if (sendChat(draft)) setDraft('');
  };

  return (
    <section className="chat-panel" aria-label={t('chat', 'title')}>
      <header className="chat-panel__head">
        <span className={`chat-dot ${chat.connected && chat.peerOnline ? 'chat-dot--on' : ''}`.trim()} />
        <h2 className="chat-panel__title">{t('chat', 'title')}</h2>
        <span className="chat-panel__status">
          {!chat.connected
            ? t('chat', 'connecting')
            : chat.peerOnline
              ? t('chat', 'peerOnline')
              : t('chat', 'peerAway')}
        </span>
        <Button
          className="chat-panel__icon"
          onClick={() => setChatSound(!chat.soundOn)}
          aria-pressed={chat.soundOn}
          title={t('chat', chat.soundOn ? 'muteSound' : 'unmuteSound')}
          aria-label={t('chat', chat.soundOn ? 'muteSound' : 'unmuteSound')}
        >
          {chat.soundOn ? <BellIcon size={14} aria-hidden /> : <BellOffIcon size={14} aria-hidden />}
        </Button>
        <Button
          className="chat-panel__icon"
          onClick={dismissChat}
          title={t('chat', 'leave')}
          aria-label={t('chat', 'leave')}
        >
          <XIcon size={14} aria-hidden />
        </Button>
        <Button
          className="chat-panel__icon"
          onClick={closeChat}
          title={t('chat', 'close')}
          aria-label={t('chat', 'close')}
        >
          <span aria-hidden>—</span>
        </Button>
      </header>

      <div className="chat-log" ref={logRef}>
        {chat.messages.length === 0 ? (
          <p className="chat-log__empty">{t('chat', 'empty')}</p>
        ) : (
          chat.messages.map((m) => <Line key={m.seq} message={m} mine={m.from === chat.seat} t={t} />)
        )}
      </div>

      {chat.error && <p className="chat-panel__error">{chat.error}</p>}

      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        // Esc closes the panel. The pause hotkey ignores typing targets (see
        // `isTypingTarget`), so without this Esc would do nothing at all in here.
        onKeyDown={(e) => {
          if (e.key === 'Escape') closeChat();
        }}
      >
        <input
          ref={inputRef}
          className="chat-compose__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat', 'placeholder')}
          aria-label={t('chat', 'placeholder')}
          autoComplete="off"
        />
        <Button
          className="chat-compose__send"
          type="submit"
          // `sendChat` plays its own cue; a click on top of it would land on the
          // same output sample and the two would fuse into one loud transient.
          silent
          disabled={!chat.connected}
          title={t('chat', 'send')}
          aria-label={t('chat', 'send')}
        >
          <SendIcon size={16} aria-hidden />
        </Button>
      </form>
    </section>
  );
}

/**
 * One message. Identified by seat, not by name — there are no nicknames in this
 * game, and "You"/"Opponent" is all two players need.
 */
function Line({ message, mine, t }: { message: ChatMessage; mine: boolean; t: T }) {
  return (
    <p className={`chat-line ${mine ? 'chat-line--mine' : ''}`.trim()}>
      <span className="chat-line__who">{t('chat', mine ? 'you' : 'opponent')}</span>
      <span className="chat-line__time">{clockOf(message.sentAt)}</span>
      <span className="chat-line__text">{message.text}</span>
    </p>
  );
}

/** The wire carries unix **seconds**; `Date` wants milliseconds. */
function clockOf(sentAt: number): string {
  return new Date(sentAt * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
