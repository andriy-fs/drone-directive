---
name: dd-chat
description: >-
  Knowledge for the Drone Directive IN-MATCH CHAT — the chat/ workspace, the Chat
  Durable Object in server/, its slice of protocol/, and the client glue
  (chatBridge, chatStorage, the store slice, ChatPanel, the typing-target hotkey
  guard, the notification sound). Use whenever a task touches chat messages,
  history/retention, presence, the chat socket, or the panel. Explains why chat is
  a second socket to a second object rather than part of the lockstep stream, the
  two places it deliberately breaks net/'s rules, and what must not be torn down
  with the match.
---

# Drone Directive — chat

Two players in an online match can talk. The feature spans four workspaces
(`protocol/`, `chat/`, `server/`, `client/`), but it is **one idea**, and every
rule below follows from it:

> **Chat outlives the match.** It survives the opponent leaving, the return to the
> menu, a page reload, and a visit days later.

That is why chat is **not** in the lockstep stream. `Room` is two-socket and
match-lifetime by construction; a conversation hung off it would die with the
match and be lost outright on F5. So chat gets its **own WebSocket to its own
Durable Object**, addressed by a relay-issued opaque `chatId` — 128 bits, nothing
to do with the 4-character room code — which both peers learn in `StartMessage`,
the one instant they are told the same thing at the same time.

Reached only from an existing network match: no lobby chat, no chat in solo/AI
games, no discovery by code. Messages are identified by **seat** ("You" /
"Opponent") — this game has no nicknames.

## Where the pieces live

| Path                                 | Holds                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `protocol/schema/messages.bare`      | `ChatSeat`, `ChatEntry`, and the four chat messages. `StartMessage.chatId`.       |
| `protocol/src/index.ts`              | Tags 5-8, `CHAT_*` constants, `QueryParam.ChatId/Seat/Since`, `sanitizeChatText`. |
| `chat/src/ChatSession.ts`            | The transport: one socket, reconnect with backoff, `send`, dedup by `seq`.        |
| `chat/src/wire/codec.ts`             | BARE ↔ `ChatMessage`; the framing is the game's.                                  |
| `chat/src/wire/validation.ts`        | valibot rules over an **inbound** entry.                                          |
| `server/src/Chat.ts`                 | The Durable Object: history, presence, rate limit, retention alarm.               |
| `server/src/Room.ts`                 | Its only involvement: `start()` generates the `chatId`.                           |
| `client/src/chat/chatBridge.ts`      | Owns the `ChatSession`, writes the store. A module singleton, outside `pixi/`.    |
| `client/src/chat/chatStorage.ts`     | `localStorage` of known chat **addresses** + the sound preference.                |
| `client/src/ui/hud/ChatPanel.tsx`    | The floating panel, mounted outside `App`'s `inMatch` guard.                      |
| `client/src/utils/isTypingTarget.ts` | The guard every `window` hotkey runs first.                                       |

`chat/` is a **sibling of `net/`**, not a layer above or below it:

```
types/  →  protocol/  →  { net/ , chat/ }  →  client/ , server/
```

Same import rule as `net/`, and in fact stricter: `protocol` and `valibot`, and
nothing else — no renderer, no React, no store, no game config, no bundler
globals. It does not depend on `types` either, because a chat message shares no
vocabulary with the simulation; `ChatMessage`/`ChatSeat` are its own. The relay URL
arrives as `ChatConfig.relayUrl` (wired in `client/src/chat/chatConfig.ts`),
exactly as `LockstepConfig` injects it for the game.

## The path a message takes

1. `ChatPanel` → `chatBridge.sendChat(text)` → `ChatSession.send`, which runs
   **`sanitizeChatText`** and refuses anything that sanitizes away to `''`.
2. `encodeChatSend` frames it under tag `5` and puts it on the **chat** socket.
3. `Chat.webSocketMessage` sanitizes again (authoritative), spends a rate-limit
   token, assigns `seq` + `sentAt`, stores the row, prunes past
   `CHAT_HISTORY_LIMIT`, broadcasts `ChatPosted` to **both** sockets, and re-arms
   the retention alarm.
4. `ChatSession.onMessage` validates the entry, drops it if `seq <= lastSeq`, and
   hands it to the bridge, which appends to the store slice.

**The sender's own echo is what confirms its `seq`.** There is no optimistic
entry with a placeholder number — the server's ordering is the only ordering.

## Rules that bite

- **One tag space, two sockets.** Chat tags share `MessageTag` but never the
  connection. `Room.relay` whitelists `Tick`, so a chat frame on a game socket is
  dropped; `net`'s `decodePayload` **throws** on tags 5-8 for the mirror-image
  reason (its `switch` is exhaustive with no `default` — that is the tripwire).
  Never relay chat through `Room`.
- **Validation is asymmetric here, and that is deliberate.** `net`'s hard rule
  (`scheduleLocal` screens the local batch too) exists because under lockstep an
  asymmetric filter _is_ a desync. Chat touches no simulation, so the server is
  simply authoritative. Do not "fix" this by making it symmetric — but do keep
  validating everything **inbound**: the object is trusted to be correct, not
  trusted to be undamaged.
- **The `Chat` object decodes payloads and `Room` does not.** Also deliberate.
  `Room`'s content-blindness is about relaying a lockstep tick; this object has to
  read a message to number and store it. Not a precedent for teaching `Room`
  anything.
- **`sanitizeChatText` is one function in `protocol/src/index.ts`**, imported by
  both the Worker and the client so what the sender sees and what the log stores
  cannot disagree. It must stay pure and dependency-free (that module is on the
  relay's hot path). Control codes become a **space**, not nothing — deleting a
  newline glues two words together. Bidi overrides are deleted. Truncation never
  splits a surrogate pair.
- **`Chat` is hibernatable; never `server.accept()` a real chat socket.** Use
  `ctx.acceptWebSocket(server, [seat])` with the seat as the tag, and find the
  peer with `ctx.getWebSockets('host'|'guest')`. Consequence, and the easy thing
  to get wrong: **no per-socket state in instance fields** — an idle object sleeps
  and loses them. The rate-limit counters live in
  `ws.serializeAttachment()`/`deserializeAttachment()`.
- **`storage.deleteAll()` takes the table with it.** `alarm()` must call
  `ensureSchema()` after erasing, or the next message fails on a missing table.
- **Retention runs from the last message.** Every post calls
  `setAlarm(Date.now() + CHAT_RETENTION_MS)`, so an active conversation is never
  erased under the players.
- **Nothing in `GameApp`'s teardown may touch chat.** `endOnline` and
  `leaveOnlineIfAny` drop `this.session` only. `attachChat` is called from
  `onStart` and that is the whole of `GameApp`'s involvement — the moment the
  opponent leaves is exactly when the players want to talk.
- **`chatBridge` is a module singleton outside `pixi/`.** It must not be a field on
  `GameApp`: that object is unmounted with the canvas.
- **The store's `chat` slice is the first with no engine snapshot behind it.** It
  is event-driven, appended to by the bridge. Never rebuild it from a tick
  snapshot, and never reset it from an online-status change.
- **`ChatPanel` is mounted outside `App`'s `inMatch` guard.** Moving it inside
  silently reintroduces "chat dies with the match".
- **Typing must not play the game.** Four `window` listeners call
  `preventDefault()` — `usePauseHotkey`, `useSelectAllHotkey`,
  `useControlGroupHotkeys`, and the drone keys in `pixi/input/pointer.ts`. Every
  one of them bails on `isTypingTarget(e.target)`. It lives in `utils/` (not
  `ui/hooks/`) precisely because the fourth is in the Pixi layer, which may not
  import from `ui/`. Any new global hotkey gets the same guard.
- **`since` is what is already on screen, not what was once received.** After a
  reload the panel is empty, so the bridge asks from `0` and gets the whole log;
  mid-session reconnects are `ChatSession`'s own business (it re-sends its highest
  `seq` and gets exactly the gap). `chatStorage`'s `lastSeq` is the _read_ point —
  it drives the unread badge across a page load, not the resume.
- **Notification sound: peer messages only, live ones only.** `onHistory` never
  pings, or a reconnect would replay a burst of them for a conversation the player
  already had. Two mutes exist and both are honoured: the game's global
  `sfx.setMuted` (wins, silences everything) and `chat.soundOn` (persisted,
  `dd:chatSound`). `openChat()` calls `sfx.resume()` — after a reload the player
  may never have pressed Start, and the AudioContext is suspended until a gesture.
- **Access is capability-based.** Anyone holding a `chatId` can attach as either
  seat; the object authenticates nothing. That is the accepted trade for a
  two-person chat with no accounts — recorded in `.docs/server-relay.md`, not to be
  discovered later.
- **`u32`/`u8` on the wire, never `uint`/`u64`** (they generate `bigint`).
  `sentAt` is unix **seconds**; the UI multiplies by 1000.

## Touching the schema or the object

Same four-step move as the rest of the protocol, plus one:

1. edit `protocol/schema/messages.bare`
2. `npm run codegen -w protocol`
3. **commit** `protocol/src/generated/messages.ts`
4. bump `PROTOCOL_VERSION` — every BARE change is breaking, and the relay rejects
   mismatches at connect time
5. **adding a Durable Object class** also needs a new `[[migrations]]` tag in
   `server/wrangler.toml` and a named export from `server/src/index.ts`. Migration
   tags are append-only — never edit one that has shipped.

The Worker and the static client must **deploy together** on a version bump, or
every connect fails with `version-mismatch`. See `.docs/deployment.md`.

## Commands

```bash
npm test                  # net, then chat, then the client suite
npm run type-check        # types + net + chat + server — the only thing that checks server/
npm run dev:relay         # local relay (both DOs) on ws://localhost:8787
npm run e2e -w server     # frame-level checks against that relay, chat included
```

`chat`'s unit tests need no relay — the codec and the schemas are pure. The e2e
asserts on raw bytes (history, presence, sequencing, sanitizing, resume-by-`since`,
the rate limit), so it tests the wire rather than the client's idea of it.
Two-browser behaviour — the badge, the panel surviving a match ending, F5 replay,
typing not playing the game — can only be confirmed by hand.

## Reference

`chat/README.md` (the workspace and its two departures from `net/`),
`.docs/multiplayer.md` (the chat section, and why it is not in the lockstep
stream), `.docs/server-relay.md` (the `Chat` DO, hibernation, retention, the
access limitation), `.docs/tasks/online-chat.md` (the original design record).
Sibling skills: **dd-net** for the game socket, **dd-react** for the store/HUD
conventions the panel follows.
