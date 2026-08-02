# Why BARE (`@bare-ts`)

The wire protocol for online matches is defined in
[`protocol/schema/messages.bare`](../protocol/schema/messages.bare) (180 lines) and
compiled to committed TypeScript by `npm run codegen -w protocol`. This is why
that format, and not JSON or protobuf.

## The problem it solves: the contract was fiction

Before, `protocol/src/index.ts` held hand-written TS interfaces, `WireCommand` was
literally `export type WireCommand = unknown`, and
`LockstepSession` did `msg.commands as Command[]`. Two consequences:

- **The "contract" was a second copy of the client's types**, kept in sync by
  hand and by hope. Nothing failed if they drifted.
- **A cast is not a check.** A peer's malformed JSON went straight into the
  engine.

Traffic was never the motive — it was ~4 KiB/s per player and nobody cared. The
goals were **schema-first** (the contract lives in a schema file, not in prose or
in duplicated types) and **wire types ≠ domain types** (a real boundary with a
mapping layer, not a cast).

## Why BARE and not protobuf

Protobuf was the obvious candidate and was rejected on three specific grounds.

**1. In BARE every field is required, and enums are closed.** This is the big one,
because it decides how much work the validation layer has to do. In proto3 scalar
fields have _implicit presence_ — `chassis: 0` and "absent" are indistinguishable —
and enums are **open**: an unknown value like `99` decodes fine and arrives as a
number. So "the message decoded" would have told us almost nothing, and the
shape-checking would have fallen back on valibot anyway.

With BARE, `decodeTickMessage` either succeeds — meaning every field is present
and every enum tag is a member — or throws. That is what makes the two-layer split
in [`net/`](../net) honest: **BARE proves the shape, valibot proves the meaning.**
The division isn't a diagram we drew; the format enforces it.

**2. `union` is a real sum type; `oneof` is not.** The domain's `Command` is a TS
discriminated union. BARE's `union { AssignTask | BuildRobot | … }`
with `--use-struct-flat-union` generates exactly that shape, tag and all. Protobuf
would have needed a wrapper message with a `oneof`, producing either a
`{ case, value }` box or a bag of optional fields where zero may be set — extra
awkwardness in the mapping layer for no gain.

**3. The generated code is readable and shakes out.** 825 lines of plain
TypeScript: `readTickMessage` shows exactly which bytes go where, with no registry
and no reflection. That matters for auditing a security boundary, and it is what
makes the relay bundle result below achievable.

## Why it fits the relay architecture in particular

The `Room` Durable Object is deliberately **content-blind** — it pairs two sockets,
mints a seed, and forwards bytes. It "never learns what a robot is"
([server-relay.md](./server-relay.md) § Deliberate non-goals).

BARE has **no envelope of its own**. That sounds like a gap, and it is the enabling
property here: nothing forced the message discriminant to live _inside_ the
encoded payload, so we put it in front as one octet:

```
byte 0    MessageTag — Tick 0, Created 1, Start 2, OpponentLeft 3, Error 4
byte 1+   the BARE payload
```

`Room.relay` therefore reads `bytes[0]`, and forwards `data` — the **original
bytes**, not a re-encoded message. It decides what to do with a frame without
decoding one. `protocol/src/index.ts`, which holds the framing helpers, stays
dependency-free so the Worker's hot path links no decoder at all.

The payoff is measurable, not asserted. `npx wrangler deploy --dry-run --outdir …`
produces a **13.9 KiB** Worker containing `encodeCreatedMessage`,
`encodeStartMessage` and `encodeErrorMessage` — and **zero** reader functions and
nothing from the `Command` graph.

**The alternative, rejected:** one top-level BARE `union Message { … }` that the
relay decodes to read `.tag`. That would make the relay parse an untrusted game
payload every tick, link the reader half plus the whole command graph, and give it
an opinion about game orders — a direct contradiction of its stated purpose.

**The honest caveat:** the relay _originates_ four messages
(`created`/`start`/`opponentLeft`/`error`), so it must encode them, and the writer
half of the codec is in its bundle. "No BARE runtime in the Worker" was not
achievable. The alternative — hand-writing those four encoders byte by byte —
would duplicate the schema in the one place we were trying to remove duplication
from.

## What we accepted

- **No field numbers, no schema evolution.** Every schema change is breaking,
  gated by bumping `PROTOCOL_VERSION`. Acceptable _only_ because both peers ship
  from one deploy and the version gate already hard-broke on mismatch. **This is
  the condition to watch:** the day the client must update independently of the
  relay, protobuf becomes the right answer and there is no argument to make.
- **A small ecosystem** (`@bare-ts/tools` 0.19, one maintainer). Mitigated by the
  generated code being committed and dependency-light: if the project stops, we
  keep 825 lines of ordinary TypeScript and a tiny runtime.
- **No wire tooling** — no `protoc --decode`, no `grpcurl`. `server/scripts/relay-e2e.mjs`
  asserts on raw byte offsets by hand instead. Fine at five messages; it would
  chafe at fifty.
- **The generator emits `export enum`**, which the project's `erasableSyntaxOnly`
  tsconfig flag banned. We dropped the flag and kept "prefer const-map unions" as
  a convention instead.

## Rules the format imposes

- **`f64`, never `f32`, for coordinates.** The peers compare world hashes; a
  position that survives the wire with less precision than it had is a desync a
  few ticks later. There is a test for it.
- **`u32`/`u8`, not `uint`/`u64`** — the latter generate `bigint`.
- Editing the schema is four steps: edit → `npm run codegen -w protocol` →
  **commit** the output → bump `PROTOCOL_VERSION`. Nothing in CI does it for you.

See [`protocol/README.md`](../protocol/README.md) for the framing and codegen
mechanics, and [valibot.md](./valibot.md) for the layer that runs after decoding.
