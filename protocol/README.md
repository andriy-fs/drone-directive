# @drone-directive/protocol

The wire protocol for online multiplayer, shared by `@drone-directive/client` (the
game) and `@drone-directive/server` (the relay Worker) so neither imports the
other's source. No game logic lives here.

**The contract is a schema, not hand-written types.** Messages are defined in
[`schema/messages.bare`](./schema/messages.bare) ([BARE](https://baremessages.org/))
and compiled to `src/generated/messages.ts`, which is **committed** — this
workspace has no build step (`exports` point straight at source), and adding one
would mean ordering the Pages build against it for no benefit.

```bash
npm run codegen -w protocol   # regenerate after editing the schema, then commit the result
```

| Path                        | Holds                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `schema/messages.bare`      | The message definitions — the source of truth.                                          |
| `src/generated/messages.ts` | Generated encoders/decoders (`@drone-directive/protocol/codec`). Do not edit.           |
| `src/index.ts`              | What a schema cannot express: the handshake constants and the framing. No dependencies. |

## Framing

A frame is **one tag octet followed by the BARE payload**:

```
byte 0    MessageTag — game:  Tick 0, Created 1, Start 2, OpponentLeft 3, Error 4
                       chat:  ChatSend 5, ChatHistory 6, ChatPosted 7, ChatPresence 8
byte 1+   the BARE-encoded body of that message (empty for opponentLeft)
```

The tag sits _outside_ the payload so the relay can route a frame by reading
`bytes[0]` and forward the rest untouched — it never decodes a game payload, and
the decoder half of the codec never enters its bundle. That is also why
`src/index.ts` stays dependency-free: it is on the Worker's hot path.

**One tag space, two sockets.** Chat tags share the numbering but never the
connection: they run against the `Chat` Durable Object over a socket of their own
(`/chat`), with a lifetime that outlives the match. `Room` forwards `Tick` and
nothing else, so a chat frame on a game socket is dropped; `@drone-directive/net`
throws on one for the mirror-image reason. Unlike `Room`, the chat object _does_
decode its payloads — it has to, to number and store them — which is a property of
that object, not a hole in the relay's content-blindness.

## Resuming a seat

`StartMessage` carries a per-seat `resumeToken`, which is the one field the two
peers are told different values of — so the two `start` frames are **not**
byte-identical, and anything asserting that (the e2e does) has to compare the
prefix instead. A dropped client presents its token as `?resume=<token>` to
reclaim its seat inside `RESUME_GRACE_MS`; the room code is four typeable
characters and could never protect a live match on its own. The constants
(`RESUME_GRACE_MS`, `RESUME_BUFFER_FRAMES`, `RESUME_TOKEN_LENGTH`) live in
`src/index.ts` with the rest of what a schema cannot express.

## Versioning

BARE has no field numbers and no schema evolution, so **every change to the schema
is breaking**. Bump `PROTOCOL_VERSION` with it — the relay checks it at connect
time and rejects mismatches, which was already a hard break before the protocol
went binary.

Decoding proves a message's _shape_; it says nothing about whether the values make
sense in a given match. That check lives one layer up, in
[`@drone-directive/net`](../net) (`src/wire/validation/`) — it needs game
knowledge the relay must not have. See
[../.docs/multiplayer.md](../.docs/multiplayer.md).
