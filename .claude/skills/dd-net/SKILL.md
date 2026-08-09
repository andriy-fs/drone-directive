---
name: dd-net
description: >-
  Knowledge for the Drone Directive ONLINE STACK — the types/, protocol/, net/
  and server/ workspaces. Use whenever a task changes the wire protocol (the BARE
  schema or its codegen), the lockstep transport, command validation, the relay
  Worker/Durable Object, or the shared value types. Explains the workspace
  dependency order, the tag-byte framing, the shape-vs-meaning split between BARE
  and valibot, why input filters must be symmetric, and what has to be bumped or
  regenerated together.
---

# Drone Directive — the online stack (4 workspaces)

Everything outside the client's three layers. Dependency order is **one-way** — each may only import from the ones above it:

| Workspace   | Package                     | Holds                                                                  | Depends on                           |
| ----------- | --------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `types/`    | `@drone-directive/types`    | `enums`, `commands`, `entities`, `tasks` — the game's vocabulary.      | **nothing**                          |
| `protocol/` | `@drone-directive/protocol` | `schema/messages.bare`, committed codegen, framing + handshake consts. | `@bare-ts/lib` (generated code only) |
| `net/`      | `@drone-directive/net`      | `LockstepSession`, `wire/codec/`, `wire/validation/`.                  | types, protocol, valibot             |
| `server/`   | `@drone-directive/server`   | Relay Worker + `Room` Durable Object.                                  | protocol only                        |

`client/` sits below all of them. **No game layer owns socket, codec or validation code** — if you are about to add any under `client/src/pixi/**` or `client/src/engine/**`, it belongs here instead.

**Chat is not this skill.** It is a sibling workspace (`chat/`) on a second socket
to a second Durable Object (`server/src/Chat.ts`), sharing only the tag space and
`protocol/`. It deliberately breaks two of the rules below — its object decodes
payloads, and its validation is asymmetric. Load **dd-chat** before touching any
of it. What does concern this skill: `MessageTag` 5-8 belong to chat, and
`decodePayload` must keep throwing on them.

## The path a peer's frame takes

1. **`server/src/Room.ts`** reads `bytes[0]` (the `MessageTag` octet) and forwards a `Tick` frame's **original bytes** to the peer. It never decodes a payload.
2. **`net/src/wire/codec/`** (`frames.ts` → `commands.ts` → `enums.ts`) unframes, BARE-decodes, and maps wire → domain vocabulary (`ChassisType.Tracks` → `'tracks'`, `possess/fire` → `possessPulse/firePulse`, the tri-state `BuildTask` → `task?: TaskType | null`). Returns `null` on any `BareError`, unknown tag, truncation or trailing bytes.
3. **`net/src/wire/validation/`** (`schemas.ts` = the rules, `parser.ts` = what a failure costs) checks with valibot what BARE cannot: finite coordinates inside the current map, non-empty id lists within `maxRobots`, batch size, id length.
4. **`net/src/lockstep/`** buffers per tick (`input.ts` screens a decoded frame, `LockstepSession.ts` holds the buffers); `GameApp.stepOnline` applies both sides' commands in roster order.

**BARE proves the shape, valibot proves the meaning.** Decoding does not make a frame safe — a well-formed f64 can be `NaN`.

## A dropped socket is not a dropped match

Neither peer advances without both sides' input for the current tick, so a client that loses its connection falls **zero** ticks behind — a reconnect is re-delivery, never catch-up. `Room` holds the seat for `RESUME_GRACE_MS` (20s) and rings the frames aimed at it (still opaque bytes — nothing is decoded to hold them); `LockstepSession` keeps an outbox, re-attaches with `?resume=<token>`, and replays what is outstanding. The peer's own tick stream is the acknowledgement: it could not have reached tick N without our input for `N - INPUT_DELAY_TICKS`. The surviving client needs nothing new — it stalls, exactly as it does for lag. Only when the grace expires does `opponentLeft` go out.

Seats are named by the per-seat `resumeToken` in `start`, never by the room code (four typeable characters). That makes the two `start` frames the one pair of messages that are deliberately **not** byte-identical.

## Rules that bite

- **Filters must be symmetric.** `scheduleLocal` runs `parseCommands` on the **local** batch too. Under lockstep a filter only one side applies _is_ a desync: one client applies the order, the other drops it, the worlds part. Same reasoning as `isCommandFrom` in `GameApp.stepOnline`. Anything new that can drop a command obeys this.
- **Nothing match-specific is imported into `net`.** World bounds + robot cap arrive as `LockstepConfig.limits()` — a **thunk**, because `applyMapSize` rewrites `worldPixelSize` per match and a captured bound would reject legal orders after a resize. Relay URL is `LockstepConfig.relayUrl`; dev logging is `setNetDebug(enabled)`. All three are wired in `client/src/config/multiplayer.ts`. Never reach for `import.meta.env` or `gameConfig` inside `net`.
- **A new command kind touches nine places, and only eight of them fail the build.** `types/src/commands.ts` → the `.bare` struct **appended last** to `type Command union` (so existing tags keep their numbers) → codegen + commit → `PROTOCOL_VERSION` → a case in each of `commandToWire`/`commandFromWire` → **both** halves of `validation/schemas.ts` → the `Record<Command['kind'], Command>` sample in `validation.test.ts` → `isCommandFrom` **and** `applyCommand` in the engine. The one that does not fail the build is the `v.variant('kind', [...])` array in `schemas.ts`: a kind missing there compiles, works perfectly offline, and silently never arrives online. The exhaustive test sample is what catches it — write the sample before the schema. `server/` needs nothing; `relay-e2e.mjs` reads the version by regex.
- **Editing the schema is a four-step move:** edit `protocol/schema/messages.bare` → `npm run codegen -w protocol` → **commit** `protocol/src/generated/messages.ts` → bump `PROTOCOL_VERSION` in `protocol/src/index.ts`. BARE has no field numbers, so _every_ schema change is breaking; the relay rejects version mismatches at connect time. Nothing in CI regenerates for you.
- **`protocol/src/index.ts` stays dependency-free** — it is on the Worker's hot path, which must route a frame without linking a decoder. Framing (`MessageTag`, `frame`, `tagOf`, `payloadOf`) lives there; message shapes come from `@drone-directive/protocol/codec`.
- **`f64`, never `f32`, for coordinates.** Rounding a position on the wire desyncs the peers a few ticks later. There is a test for this.
- **Integer types:** `uint`/`u64` generate `bigint`. Use `u32`/`u8` so the generated code stays on `number`.
- **The relay stays dumb.** It encodes the four messages it originates and decodes nothing. Don't teach `Room.ts` about commands — that is the deliberate non-goal in `.docs/server-relay.md`.
- **The pause is input, not a message.** `TickMessage.pauseToggle` is a pulse applied on the same tick by both peers, so it needs no ordering rule and no owner: two pulses on one tick are two flips, which composes identically either way. `GameApp.stepOnline` derives the shared flag; the heartbeat keeps running while paused, which is the only reason it can be lifted.
- **`worldHash` is not here.** It reads the ECS world, so it lives at `client/src/engine/worldHash.ts`; `net` only ever sees the resulting number via `recordHash(tick, hash)`.

## Adding to `types/`

A value type earns a place there only if **two or more workspaces** need it (in practice `client` + `net`). Behaviour and tunables stay in `client/src/config/gameConfig.ts`; the ECS `Entity` stays in the engine (it would drag miniplex in); wire message types are generated, never hand-written.

## Commands

```bash
npm test                      # runs the net suite, then the client suite
npm run type-check            # types + net + server (NOT covered by `npm run build`)
npm run lint                  # root eslint, covers every workspace
npm run codegen -w protocol   # after editing the .bare schema — commit the output
npm run dev:relay             # local relay on ws://localhost:8787
npm run e2e -w server         # frame-level check against that running relay (needs it up)
```

`net`'s tests need no game — `CommandLimits` is three plain numbers. `npm run e2e -w server` asserts on raw bytes, so it tests the wire rather than the client's idea of it.

## Reference

`net/README.md`, `protocol/README.md`, `types/README.md`, `.docs/multiplayer.md` (lockstep design + validation), `.docs/server-relay.md` (Worker + DO implementation).
