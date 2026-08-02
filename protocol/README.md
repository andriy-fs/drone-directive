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
byte 0    MessageTag — Tick 0, Created 1, Start 2, OpponentLeft 3, Error 4
byte 1+   the BARE-encoded body of that message (empty for opponentLeft)
```

The tag sits _outside_ the payload so the relay can route a frame by reading
`bytes[0]` and forward the rest untouched — it never decodes a game payload, and
the decoder half of the codec never enters its bundle. That is also why
`src/index.ts` stays dependency-free: it is on the Worker's hot path.

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
