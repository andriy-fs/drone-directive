# @drone-directive/chat

The chat boundary: one WebSocket to one `Chat` Durable Object, the codec that
turns its frames into `ChatMessage`s, and the rules a decoded message still has to
satisfy. Nothing else.

A **sibling of [`@drone-directive/net`](../net)**, not a layer above or below it:

```
types/  →  protocol/  →  { net/ , chat/ }  →  client/ , server/
```

It depends on `types`, `protocol` and `valibot`, and on nothing else — no
renderer, no React, no store, no game config, no bundler globals. Where the relay
lives arrives as `ChatConfig.relayUrl`, exactly as `LockstepConfig` injects it for
the game, which is what lets the package be tested without a running relay.

| Path                     | Holds                                                            |
| ------------------------ | ---------------------------------------------------------------- |
| `src/ChatSession.ts`     | The transport: one socket, reconnect with backoff, `send`.       |
| `src/config.ts`          | `chatConnectUrl` — the handshake, which travels as query params. |
| `src/wire/codec.ts`      | BARE ↔ `ChatMessage`, and the framing shared with the game.      |
| `src/wire/validation.ts` | valibot rules over an incoming entry.                            |
| `src/types.ts`           | `ChatMessage`, `ChatSeat`, `ChatConfig`, `ChatHandlers`.         |

## Why chat is not in the lockstep stream

Chat gets its own socket to its own object, addressed by a relay-issued opaque
`chatId` that both peers learn in `StartMessage`. That is what buys the property
the feature exists for: **chat outlives the match.** The game `Room` is
match-lifetime and two-socket by design; hanging a conversation off it would end
the conversation with the match, and a page reload would lose it outright. So
`Room` is untouched apart from generating the id.

The two live in one tag space (`MessageTag`) but never on one connection. `Room`
forwards `Tick` and nothing else, so a chat frame on a game socket is dropped;
`net`'s decoder throws on one for the mirror-image reason.

## Two deliberate departures from `net`

**The chat object decodes its payloads.** `Room` never looks inside a frame — the
tag octet sits outside the payload precisely so it doesn't have to. The `Chat`
object does look, because it has to: it assigns sequence numbers, stores the log
and caps it. That is not a hole in the relay's content-blindness; it is a
different object doing a different job. Nothing about a chat message is a
simulation input.

**Validation is asymmetric.** `net` has a hard rule that `scheduleLocal` screens
the _local_ batch too, because under lockstep a filter one peer applies and the
other doesn't _is_ a desync. That argument does not reach here. Chat touches no
simulation, so the server is simply authoritative: it sanitizes and rate-limits,
the client runs the same `sanitizeChatText` on its own outgoing text, and if the
two ever disagreed it would cost a re-render, not a match. The client still
validates everything **inbound** — the object is trusted to be correct, not
trusted to be undamaged.

## Access

Access is capability-based: anyone holding a `chatId` can attach as either seat.
With a 128-bit relay-issued id that never leaves the two clients, that is the
right trade for a two-person chat — see
[../.docs/server-relay.md](../.docs/server-relay.md).
