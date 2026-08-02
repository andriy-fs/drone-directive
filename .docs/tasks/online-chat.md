# Online chat — implementation plan

Design record, agreed but **not yet implemented**. Nothing in the repository has been changed for it.

## Context

Players in an online match have no way to talk to each other. The requirement, as agreed:

- Chat is reachable **only from an existing network match** ("chat with opponent") — there is no lobby chat, no chat in solo/AI games, and no chat discovery by code.
- Chat **outlives the match**, in the strong sense: its state lives on the server and clients re-attach to it after the match ends, after a page reload, and on a later visit.
- Chat lives in a **new workspace** and reuses the **existing protocol** (the same BARE schema, the same tag-octet framing).

The design decision that makes this tractable: chat gets its **own WebSocket to its own Durable Object**, addressed by a relay-issued opaque `chatId` — completely detached from the game `Room` and its 4-character, client-generated room code. `Room` keeps its two-socket, match-lifetime, content-blind contract untouched; the chat object owns a different lifetime and a different job.

Decisions taken: **7-day retention** from the last message; **floating panel over the canvas**; **relay issues `chatId` in `StartMessage`**; **messages identified by seat** ("You"/"Opponent"), no nicknames.

---

## Architecture

New workspace `chat/` (`@drone-directive/chat`) becomes a **sibling of `net/`** in the one-way dependency order:

```
types/  →  protocol/  →  { net/ , chat/ }  →  client/ , server/
```

`chat/` depends on `types`, `protocol` and `valibot`, and on nothing else — same rule as `net/`: no renderer, no React, no store, no game config, no bundler globals. Relay URL is injected via `ChatConfig`, mirroring `LockstepConfig`.

Two properties differ from `net/`, deliberately, and should be stated in the new README:

- **The chat Durable Object is not content-blind.** Unlike `Room`, it decodes payloads — it has to, in order to store history, assign sequence numbers, and cap the log. `Room`'s "never decode a game payload" rule is about relaying a lockstep tick; it does not generalize to a different object with a different job.
- **Validation is not symmetric.** `net`'s hard rule (`scheduleLocal` screens the local batch too) exists because an asymmetric filter under lockstep _is_ a desync. Chat touches no simulation, so the server is simply authoritative: it sanitizes and rate-limits, the client sanitizes for its own optimistic echo, and a disagreement costs nothing.

---

## 1. `protocol/` — schema, framing, constants

**`protocol/schema/messages.bare`**

- `StartMessage` gains `chatId: str` — how both peers learn the same id at the same instant. This is the only change to an existing message.
- New types:

  ```
  type ChatSeat enum { HOST = 0  GUEST = 1 }

  type ChatEntry struct {
      seq: u32          # server-assigned, monotonic, orders the log
      from: ChatSeat
      text: str
      sentAt: u32       # unix seconds — u32/u8 only, never uint/u64 (bigint)
  }

  type ChatSendMessage struct { text: str }                                    # client -> DO
  type ChatHistoryMessage struct { entries: list<ChatEntry>  peerOnline: bool } # DO -> client, on connect
  type ChatPostedMessage struct { entry: ChatEntry }                            # DO -> both clients
  type ChatPresenceMessage struct { peerOnline: bool }                          # DO -> client
  ```

**`protocol/src/index.ts`** (stays dependency-free — it is on the Worker's hot path)

- `MessageTag` gains `ChatSend: 5, ChatHistory: 6, ChatPosted: 7, ChatPresence: 8`. One shared tag space, as "use the existing protocol" implies. `Room.relay()` already whitelists `Tick` only, so chat tags arriving on a game socket are dropped with no change to `Room`.
- `CHAT_PATH = '/chat'`, `CHAT_ID_LENGTH = 32` (hex of 16 random bytes), `MAX_CHAT_TEXT_LENGTH = 500`, `CHAT_HISTORY_LIMIT = 200`, `CHAT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000`, `CHAT_RATE_LIMIT = { messages: 10, windowMs: 10_000 }`.
- `QueryParam` gains `ChatId: 'chat'`, `Seat: 'seat'`, `Since: 'since'`. Seat and resume point travel as query params, like the existing create/join intent — the socket must target a chat before it opens, so there is no `hello` message.
- `sanitizeChatText(raw: string): string` — pure, dependency-free, so both the Worker and the client import the _same_ function: NFC-normalize, strip C0/C1 controls and bidi overrides, collapse whitespace runs, trim, slice to `MAX_CHAT_TEXT_LENGTH`. Returns `''` for anything that sanitizes away, which callers treat as "reject".
- Bump `PROTOCOL_VERSION` **5 → 6**.

Then: `npm run codegen -w protocol` and **commit** `protocol/src/generated/messages.ts`. Update `protocol/README.md`'s framing table.

---

## 2. `net/` — minimal, forced changes only

- `wire/codec/frames.ts`: `DecodedMessage`'s `start` variant gains `chatId`; `decodePayload` passes it through. Its `switch` over `MessageTag` is exhaustive with no `default`, so the four new tags **will fail to compile** — that is the intended tripwire. Add one explicit branch: chat tags never arrive on the game socket, so throw (which `decodeServerMessage` already converts to `null`).
- `lockstep/types.ts`: `LockstepHandlers.onStart` gains `chatId: string`; `LockstepSession.onMessage` forwards it.
- Nothing else in `net/` changes. It never learns that chat exists beyond carrying one opaque string.

---

## 3. `chat/` — the new workspace

```
chat/
  package.json        deps: @drone-directive/protocol, @drone-directive/types, valibot
  tsconfig.json       copy net/tsconfig.json verbatim (lib: ES2023 + DOM, for WebSocket only)
  vitest.config.ts    copy net/vitest.config.ts verbatim
  README.md
  src/
    index.ts          public surface
    types.ts          ChatMessage, ChatSeat, ChatConfig, ChatHandlers
    config.ts         chatConnectUrl(relayUrl, { chatId, seat, since })
    wire/
      codec.ts        frame/unframe + BARE <-> domain mapping (mirrors net/src/wire/codec)
      codec.test.ts
      validation.ts   valibot schema over an incoming ChatEntry
      validation.test.ts
    ChatSession.ts    the transport
```

**`ChatSession`** — the one thing that owns the chat socket:

- `connect(chatId, seat, sinceSeq)` / `disconnect()`; `send(text)`.
- Handlers: `onHistory(entries, peerOnline)`, `onPosted(entry)`, `onPresence(peerOnline)`, `onOpen`, `onClose`, `onError`.
- **Reconnect with backoff** (1s → 2s → 4s → 8s, capped ~30s, reset on a clean open), because "re-attach after a reload" is the whole point of the design. On every reconnect it re-sends `since = highest seq seen`, so the DO replies with exactly the gap.
- `binaryType = 'arraybuffer'` (same reason as `LockstepSession`: frames are BARE, and a `Blob` can only be read asynchronously).
- Every inbound entry passes `wire/validation` before reaching a handler — the DO is trusted to be correct, not trusted to be undamaged.

Root wiring: add `"chat"` to `workspaces` in `package.json`, and to the root `test` (`npm run test -w chat`) and `type-check` scripts. Root `eslint .` picks it up with no config change.

---

## 4. `server/` — one line in `Room`, one new Durable Object

**`server/src/Room.ts`** — the _only_ change: `start()` generates `chatId` (hex of `crypto.getRandomValues(new Uint8Array(16))`) and includes it in the `StartMessage` both peers receive. `relay()`, `onClose`, and the two-socket model are untouched.

**`server/src/Chat.ts`** — new Durable Object, **hibernatable from day one**:

- `constructor(ctx: DurableObjectState, env: Env)`; `fetch()` checks `v` against `PROTOCOL_VERSION`, reads `seat` and `since`, then `ctx.acceptWebSocket(server, [seat])` — _not_ `server.accept()`. The seat is the hibernation tag, so `ctx.getWebSockets('host'|'guest')` finds the peer without in-memory state. This is why the chat object can idle for days at no cost; do **not** copy `Room.wire()`'s `addEventListener` style here.
- Handlers are DO methods: `webSocketMessage(ws, data)`, `webSocketClose(ws, …)`, `webSocketError(ws, …)`.
- On connect: reply `ChatHistory` with entries where `seq > since` (capped at `CHAT_HISTORY_LIMIT`), plus current presence; broadcast `ChatPresence(true)` to the peer.
- On `ChatSend`: `sanitizeChatText` (reject empty result), rate-limit, assign `seq` and `sentAt`, persist, broadcast `ChatPosted` to **both** sockets (the sender's echo is what confirms its seq), then `ctx.storage.setAlarm(Date.now() + CHAT_RETENTION_MS)`.
- **Rate limiting must survive hibernation.** In-memory counters are lost when the object sleeps, so keep `{ seat, windowStart, count }` in `ws.serializeAttachment()` / `deserializeAttachment()`.
- Storage: `ctx.storage.sql` — `messages(seq INTEGER PRIMARY KEY, seat INTEGER NOT NULL, text TEXT NOT NULL, sent_at INTEGER NOT NULL)`, plus the next seq. Delete rows beyond `CHAT_HISTORY_LIMIT` after each insert.
- `alarm()` → `ctx.storage.deleteAll()` (which drops the pending alarm too). Retention is 7 days from the **last message**, since every post re-arms the alarm.

**`server/src/index.ts`** — route `url.pathname === CHAT_PATH` to `env.CHAT.idFromName(chatId)`; keep the existing `?room=` path for `ROOM`. Reject a missing/short `chatId` with 400.

**`server/wrangler.toml`** — add the `CHAT` binding and a **new migration tag**:

```toml
[[durable_objects.bindings]]
name = "CHAT"
class_name = "Chat"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["Chat"]
```

Export `Chat` from `server/src/index.ts` alongside `Room`, or wrangler cannot bind it.

**Known and accepted limitation:** access is capability-based — anyone holding a `chatId` can attach as either seat. With a 128-bit relay-issued id that never leaves the two clients, this is the right trade for a two-person chat; record it in `.docs/server-relay.md` rather than leave it implicit.

---

## 5. `client/` — bridge, store, UI

**`client/src/chat/`** (new top-level folder, a peer of `store/` and `config/`; it is app-level glue, not part of engine/pixi/ui):

- `chatConfig.ts` — `{ relayUrl: MULTIPLAYER_URL }`, reusing the existing constant from `client/src/config/multiplayer.ts`.
- `chatStorage.ts` — localStorage of known chats: `{ chatId, seat, roomCode, lastSeq, lastActivity }[]`, pruned past `CHAT_RETENTION_MS`. This is what survives F5; without it a reload loses the chat even though the server still has it.
- `chatBridge.ts` — module singleton owning one `ChatSession` and pushing into the store. Exactly parallel to how `GameApp` owns `LockstepSession`; it lives outside `pixi/` because chat has no renderer and must not die with the match.

**`client/src/pixi/GameApp.ts`** — `onStart` gains `chatId`: record it via `chatStorage` and put it in the store. Critically, `endOnline()` and `leaveOnlineIfAny()` must **not** touch the chat — they tear down `this.session` only. That separation is the client-side half of "chat outlives the match".

**`client/src/store/gameStore.ts`** — a `chat` slice: `{ open, chatId, seat, connected, peerOnline, messages, unread, error }`, actions `openChat/closeChat/sendChat/markRead` plus bridge-only setters, with selectors in `selectors.ts`. Note for the implementer: this is the store's first slice with no engine snapshot behind it — it is event-driven, appended to by the bridge, and must not be rebuilt from a tick snapshot.

**`client/src/ui/hud/ChatPanel.tsx`** — floating panel over the canvas, mounted in `client/src/ui/App.tsx` **outside** the `inMatch` guard so it survives the return to the menu. Collapsed state is a button with an unread badge; expanded shows the log, a presence dot, and the input. Entry point is a "chat with opponent" button in the HUD while `online.status === 'inMatch'`, and the same floating button afterwards whenever `chatStorage` has a live chat.

**Hotkey guard — must not be skipped.** `usePauseHotkey`, `useSelectAllHotkey` and `useControlGroupHotkeys` all listen on `window` with **no check on the event target**, and all call `e.preventDefault()`. As written, typing in a chat input would pause the game (Space/P/Esc), select the whole army (Ctrl+A), recall control groups (digits), and swallow the keystrokes. Add one shared helper (e.g. `client/src/ui/hooks/isTypingTarget.ts`) that returns true for `input`/`textarea`/`[contenteditable]` targets, and bail out early in all three hooks. Cover it with a test.

**i18n** — a `chat` section in all four locales: `en.ts`, `uk.ts`, `ru.ts`, `pl.ts`.

---

## 6. Docs

- `chat/README.md` — the workspace's job and its two deliberate departures from `net/` (decoding DO, asymmetric validation).
- `.docs/multiplayer.md` — a chat section: separate socket, separate DO, why it is _not_ in the lockstep stream.
- `.docs/server-relay.md` — the `Chat` DO, hibernation, retention, and the capability-based access limitation.
- `CLAUDE.md` — the workspace list becomes six; update the dependency order and the root script descriptions.
- Consider a `dd-chat` skill, or a chat section in `dd-net`.

---

## Verification

Order matters — the schema change breaks compilation everywhere until step 1 is complete.

1. `npm run codegen -w protocol` → commit the generated file. Nothing in CI regenerates it.
2. `npm run type-check` (types, net, server — **and add chat**). The only thing that checks `server/`; `npm run build` does not reach it.
3. `npm test` — net, chat, client suites. New unit coverage: chat codec round-trip, `sanitizeChatText` (control chars, bidi, over-length, whitespace-only), the valibot entry schema, and the hotkey `isTypingTarget` guard.
4. `npm run build` and `npm run lint` clean.
5. `npm run dev:relay` + `npm run e2e -w server`. Extend `server/scripts/relay-e2e.mjs` with pinned raw-byte cases — it asserts on the wire rather than the client's idea of it, and the new tag numbers belong there as literals:
   - `StartMessage` now carries a 32-char `chatId`;
   - two sockets on `/chat` with the same id, opposite seats: a send reaches both, with `seq` increasing;
   - reconnect with `since=<seq>` returns only the gap;
   - a socket closing flips the peer's presence;
   - over-length text is truncated, whitespace-only is rejected, and the rate limit trips.
6. **Manual, two browsers** (headless cannot confirm this):
   - host + join → chat button appears, both sides exchange messages;
   - one player leaves the match → both return to the menu and **the chat is still there with its history**;
   - F5 on one side → it reconnects and replays the messages it missed;
   - close the tab, reopen later → chat is reachable from the floating button;
   - typing `space`, `p`, `1`-`9`, `Ctrl+A` in the chat input changes nothing in the game.
7. **Deploy note:** `PROTOCOL_VERSION` 5 → 6 is breaking, and the migration adds a DO class. The Worker and the static client must ship together, or every connect fails with `version-mismatch`. See `.docs/deployment.md`.

---

## Suggested sequencing

Each step ends type-clean, so the work can be split across sessions:

1. `protocol/` — schema + constants + `sanitizeChatText` + codegen + version bump.
2. `net/` — the forced `chatId` pass-through and the exhaustive-switch branch.
3. `chat/` workspace — codec, validation, `ChatSession`, tests, root script wiring.
4. `server/` — `Chat` DO, routing, wrangler binding + migration, the one line in `Room`.
5. `client/` — bridge, storage, store slice, panel, hotkey guard, i18n.
6. Docs, e2e extension, manual two-browser pass.
