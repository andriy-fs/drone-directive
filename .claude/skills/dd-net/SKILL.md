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

## The path a peer's frame takes

1. **`server/src/Room.ts`** reads `bytes[0]` (the `MessageTag` octet) and forwards a `Tick` frame's **original bytes** to the peer. It never decodes a payload.
2. **`net/src/wire/codec/`** (`frames.ts` → `commands.ts` → `enums.ts`) unframes, BARE-decodes, and maps wire → domain vocabulary (`ChassisType.Tracks` → `'tracks'`, `possess/fire` → `possessPulse/firePulse`, the tri-state `BuildTask` → `task?: TaskType | null`). Returns `null` on any `BareError`, unknown tag, truncation or trailing bytes.
3. **`net/src/wire/validation/`** (`schemas.ts` = the rules, `parser.ts` = what a failure costs) checks with valibot what BARE cannot: finite coordinates inside the current map, non-empty id lists within `maxRobots`, batch size, id length.
4. **`net/src/lockstep/`** buffers per tick (`input.ts` screens a decoded frame, `LockstepSession.ts` holds the buffers); `GameApp.stepOnline` applies both sides' commands in roster order.

**BARE proves the shape, valibot proves the meaning.** Decoding does not make a frame safe — a well-formed f64 can be `NaN`.

## Rules that bite

- **Filters must be symmetric.** `scheduleLocal` runs `parseCommands` on the **local** batch too. Under lockstep a filter only one side applies _is_ a desync: one client applies the order, the other drops it, the worlds part. Same reasoning as `isCommandFrom` in `GameApp.stepOnline`. Anything new that can drop a command obeys this.
- **Nothing match-specific is imported into `net`.** World bounds + robot cap arrive as `LockstepConfig.limits()` — a **thunk**, because `applyMapSize` rewrites `worldPixelSize` per match and a captured bound would reject legal orders after a resize. Relay URL is `LockstepConfig.relayUrl`; dev logging is `setNetDebug(enabled)`. All three are wired in `client/src/config/multiplayer.ts`. Never reach for `import.meta.env` or `gameConfig` inside `net`.
- **Editing the schema is a four-step move:** edit `protocol/schema/messages.bare` → `npm run codegen -w protocol` → **commit** `protocol/src/generated/messages.ts` → bump `PROTOCOL_VERSION` in `protocol/src/index.ts`. BARE has no field numbers, so _every_ schema change is breaking; the relay rejects version mismatches at connect time. Nothing in CI regenerates for you.
- **`protocol/src/index.ts` stays dependency-free** — it is on the Worker's hot path, which must route a frame without linking a decoder. Framing (`MessageTag`, `frame`, `tagOf`, `payloadOf`) lives there; message shapes come from `@drone-directive/protocol/codec`.
- **`f64`, never `f32`, for coordinates.** Rounding a position on the wire desyncs the peers a few ticks later. There is a test for this.
- **Integer types:** `uint`/`u64` generate `bigint`. Use `u32`/`u8` so the generated code stays on `number`.
- **The relay stays dumb.** It encodes the four messages it originates and decodes nothing. Don't teach `Room.ts` about commands — that is the deliberate non-goal in `.docs/server-relay.md`.
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
