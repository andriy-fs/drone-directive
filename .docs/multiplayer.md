# Multiplayer over WebSocket

Two-human online matches over a thin WebSocket relay (bots may fill the other
seats — see "Bots online" below). **Implemented** — this documents how it works.
Constraints fixed going in:

- **UI stays on GitHub Pages** (static) — the backend is a separate service.
- **Backend: Cloudflare Workers + Durable Objects.**
- **No pause in networked matches** — drop that concern entirely rather than
  synchronize it.
- **Lockstep**, chosen for implementation simplicity over the alternative
  (server-authoritative simulation) — see [Why lockstep fits here](#why-lockstep-fits-here).

## Why lockstep fits here

Lockstep networks only ship _player commands_, not world state — every client
runs the identical simulation from the same inputs. That only works if the
simulation is fully deterministic, which this engine already mostly is:

- **Fixed 30 Hz step** (`gameConfig.fixedDt`, driven by `GameLoop.ts`'s
  accumulator) — combat/AI/movement never depend on wall-clock frame time.
- **Seeded RNG** (`client/src/utils/rng.ts`, threaded through `GameContext.rng`) — no
  engine code calls `Math.random()` directly (checked: the only
  `Math.random()` calls in the repo are cosmetic, in `client/src/pixi/render/
ProjectileView.ts`'s flame flicker and `client/src/pixi/audio/sfx.ts`'s noise
  burst — both outside `client/src/engine/**` and outside the simulation).
- **All world mutation flows through one command queue** — the UI pushes
  `Command`s (`@drone-directive/types/commands`) that `commandsSystem.ts` drains and
  applies once per tick; that queue is exactly the seam the network layer
  intercepts. (Right-click move/attack originally mutated entities directly — they
  were converted to `MoveRobots` / `AttackTarget` commands so every order is
  networked and deterministic.)

Two things were _not_ deterministic and had to be fixed — RNG seeding from
`Date.now()` and a process-global entity-id counter; see [Determinism
prerequisites](#determinism-prerequisites).

## Perspective: one shared world, `localSide` for the view

The plan originally proposed "both clients play as `Owner.Player` and re-tag the
peer's commands to `Owner.AI`". That does **not** work: commands reference shared
entity ids (both clients build the identical world from the seed, so `robot_10` is
the same entity/owner on both), and the random map is asymmetric — a mirror
approach desyncs. The implemented design keeps **one identical world** on both
peers and separates simulation from presentation:

- **Ownership is fixed and shared.** `Owner.Player` holds the bottom-left corner;
  `Owner.AI` starts in one of the other three, rolled from the shared seed inside
  `createGameContext` (before `generateObstacles`, which carves the terrain around
  the placements) — so both clients land on the same corner. The **host controls
  `Owner.Player`, the guest controls `Owner.AI`.**
- **Every command applies by entity id on both peers, with no relabeling.** The
  host's orders target its `Player` units, the guest's its `AI` units; both clients
  apply both players' commands to the referenced entities, so the world stays
  byte-identical.
- **`ctx.localSide` / `store.localSide` drives presentation only** (never
  networked, never touches the sim): fog of war (`fogSystem` computes for
  `localSide`), the fog/visibility render gate, camera-follow, unit colours
  (`ownerColor` paints the local side in the "player" colour so the guest still
  sees itself as blue), box-selection (you can only select your own side), and the
  HUD's "your resources / your base". Host = `Player`, guest = `AI`.

Online matches use symmetric Normal starter counts for the human sides (the
asymmetric Easy/Hard presets only make sense against a bot).

### Bots online

A networked match is a free-for-all seating two humans (`Owner.Player` = host,
`Owner.AI` = guest) plus 0-2 bots on the remaining corners. **No bot input crosses
the wire**: `aiSystem` reads only the world, the shared match rng and its own
`ctx.ai[owner]` state, so every peer runs the same bots and reaches the same
result. That is also why the roster must be derived identically on both peers —
the host's chosen bot count rides in the `start` message (`aiCount`) rather than
coming from either client's local settings.

The practical constraint this creates: the bots consume draws from the _shared_
`ctx.rng`, so any divergence in **how many** draws a bot makes desyncs everything
downstream. `determinism.test.ts` covers this with bots seated.

**Known limitation, accepted:** each client simulates the entire world (including
the fog-hidden opponent), so a client could inspect it via devtools — the classic
lockstep-RTS issue. Fixing it needs server-authoritative simulation, the heavier
alternative this design opts out of.

## Wire protocol

Kept intentionally thin — the Durable Object understands no game rules, it just
pairs two sockets and relays bytes.

**The contract is a schema, not a set of hand-written types.** Messages are
defined in `protocol/schema/messages.bare` and compiled to
`protocol/src/generated/messages.ts` by `npm run codegen -w protocol`; the output
is **committed**, because the `@drone-directive/protocol` workspace has no build
step (its `exports` point straight at source) and giving it one would mean
ordering the Pages build against it for no benefit. `protocol/src/index.ts` keeps
only what a schema cannot express — the handshake constants and the framing.

There are no field numbers and no schema evolution: any change to the schema is a
breaking one, gated by `PROTOCOL_VERSION`, which the relay already enforces at
connect time (it was a hard break on mismatch before this too).

### Framing

A frame is **one tag octet followed by the BARE payload**:

```
byte 0    MessageTag — Tick 0, Created 1, Start 2, OpponentLeft 3, Error 4
byte 1+   the BARE-encoded body of that message (empty for opponentLeft)
```

The tag sits _outside_ the payload deliberately. It lets `Room.relay` decide what
to do with a frame by reading `bytes[0]` and forward the rest untouched, so the
relay never decodes a game payload and the decoder half of the codec never enters
its bundle — verified: the deployed Worker contains `encodeCreatedMessage` /
`encodeStartMessage` / `encodeErrorMessage` and nothing that can read a `Command`.
A top-level BARE union would have been tidier on paper, but only by teaching the
relay to parse commands, which is the one thing it is designed not to do.

### Connection

A WebSocket must target its room before it opens, so create/join intent travels
as **URL query params**, not messages (the host generates the room code
client-side, from an unambiguous alphabet):

- host: `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>`
- guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`

The Worker routes each upgrade to the Durable Object `idFromName(room)`. Messages
after that:

| Direction                     | Tag / message                                       | Purpose                                                                                         |
| ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Relay → host                  | `1` `CreatedMessage { roomCode }`                   | Room open, waiting for a guest.                                                                 |
| Relay → both                  | `2` `StartMessage { seed, mapSize, aiCount }`       | Sent once the room has 2 sockets — shared seed + match setup; fires `startMatch`.               |
| Client → relay → other client | `0` `TickMessage { tick, commands, drone, check? }` | One sim tick's commands **+ the sender's drone input**; the DO rebroadcasts the bytes verbatim. |
| Relay → remaining client      | `3` (no payload)                                    | On disconnect — the match ends (no reconnection).                                               |
| Relay → client                | `4` `ErrorMessage { code, message }`                | Join/version failures (`ROOM_NOT_FOUND` / `ROOM_FULL` / `ROOM_TAKEN` / `VERSION_MISMATCH`).     |

The `Room` Durable Object's whole job: hold up to 2 sockets, generate the seed
(`crypto.getRandomValues`) once the second connects, forward each `tick` to the
other socket, and send `opponentLeft` on disconnect. No game logic, no persistence.

## Validating the peer's input

Wire types are not domain types, and the boundary between them is a layer, not a
cast. Two things happen to a peer's frame before the engine sees it, and they
answer different questions:

1. **BARE proves the shape.** A frame either decodes into a `TickMessage` or it
   doesn't; a truncated payload, an unknown enum tag, or trailing bytes all fail.
   `net/src/wire/codec/` then maps the result into the engine's own
   vocabulary — it is the only module on the client that speaks both.
2. **Valibot proves the meaning.** A perfectly well-formed `MoveRobots` can still
   name a hundred thousand robots at `{ x: NaN }`.
   `net/src/wire/validation/` checks the game's rules: ids
   non-empty and bounded, lists within the per-side robot cap, points inside the
   _current_ map (`worldPixelSize` is rewritten per match, so the bound is read at
   validation time), `task`/`chassis`/`weapon` members of the unions in
   `@drone-directive/types/enums`. Rejected commands are dropped individually and silently — a
   match must not die over one bad order — with a dev-only warning naming the
   origin.

All of this lives in its own workspace, `@drone-directive/net`, and not in any of
the game's layers. Not `protocol/`, which is shared with the relay and must stay
ignorant of what a robot is; not the engine, which must not learn about the wire
at all; and not the Pixi layer, which is for drawing. `net` depends on the
protocol and the shared types and nothing else.

The rules that vary per match arrive as configuration rather than imports —
`LockstepConfig.limits()` is a thunk returning the map bounds and the per-side
robot cap, supplied by
[`client/src/config/multiplayer.ts`](../client/src/config/multiplayer.ts). A thunk
because `applyMapSize` rewrites the world size between matches: a bound captured
once would start refusing legal orders after the first resize. The side effect is
that the validation layer is testable with three plain numbers and no game.

**Both sides' batches go through the same filter**, not just the peer's
(`LockstepSession.scheduleLocal`). Under lockstep an asymmetric filter _is_ a
desync source: a command this client applies but the peer's validator rejects
leaves the two simulations running different worlds. Validation is a pure function
of the command plus those limits, and both peers hold the same limits, so both
reach the same verdict — the same argument that already governs `isCommandFrom` in
`GameApp.stepOnline`. Solo play never touches `LockstepSession`, so none of this
is in the offline path.

## Lockstep tick loop

Commands aren't applied the instant a player issues them — they're scheduled
a few ticks into the future so both clients are guaranteed to have received
them before simulating that tick:

1. Each fixed step, locally-issued commands (drained from the store, same as
   today) get tagged `applyAtTick = currentTick + INPUT_DELAY_TICKS` and sent
   as a `tick` message (even when empty — a steady per-tick heartbeat is
   simpler to reason about than a separate "did the peer skip this tick"
   case). `INPUT_DELAY_TICKS = 6` (~200ms at 30Hz) is a reasonable starting
   point — higher tolerates more jitter before stalling, at the cost of
   input feeling laggier.
2. `LockstepSession` (`net/src/lockstep/`) buffers both the
   local and the peer's incoming `tick` inputs (commands + drone) by tick number.
   Ticks below the delay have no scheduled input on either side (implicitly empty),
   so the sim self-bootstraps.
3. Each `GameApp.step()`, if the session has _both_ sides' input for the current
   net tick, it enqueues both players' commands (by entity id, no relabeling), sets
   each side's drone input (`local` → `localSide`, `peer` → the other side), ticks,
   then schedules fresh local input for `netTick + INPUT_DELAY_TICKS`. If not, it
   stalls (no-op) — both clients stall the same way under lag.
4. `GameLoop.ts` needs **no changes**: its fixed-step accumulator already calls
   `step()` as many times per frame as wall-clock demands, so the online path
   advances ≤1 net tick per call and catches up naturally after a stall.

## Determinism prerequisites

- `createGameContext` (`client/src/engine/game/context.ts`) takes the seed as a
  parameter instead of deriving it from `Date.now()` — the `start` message's `seed`
  is `GameEngine.startMatch`'s source of truth online (the `Date.now()` fallback is
  kept for solo play).
- **Entity ids reset per match.** `utils/id.ts` used a process-global counter that
  never reset, so a client that had played a solo match first would assign
  different ids than a fresh peer — an instant desync. `resetIds()` now runs at the
  start of every match (after the world is cleared).
- Invariant, still holds: no `Math.random()` / `Date.now()` / `performance.now()`
  anywhere under `client/src/engine/**`.
- A determinism test (`client/src/engine/game/determinism.test.ts`) asserts two
  engines with the same seed produce bit-identical worlds after 150 ticks.
- **Desync detection is live.** Every `DESYNC_CHECK_EVERY` ticks each peer hashes
  its world (`client/src/engine/worldHash.ts`) and piggybacks the result on its
  next `tick` message as `check: { tick, hash }`. The receiver compares it against
  its own hash for that tick; a mismatch ends the match with an explicit "desync at
  tick N" instead of letting the two clients drift on showing different battles.
  The probe covers simulation state only — never anything derived from `localSide`,
  which legitimately differs per client.

## Explicitly out of scope

- **Pause** — not synchronized; the in-match pause hotkey and button are disabled
  online (`usePauseHotkey.ts` + `PauseButton`, gated on `online.status`).
- **Reconnection** — a dropped socket ends the match (`opponentLeft`); no
  resume/rejoin flow.
- **Anti-cheat / hiding fog-of-war state from the client** — accepted
  limitation of lockstep, see above.
- **More than 2 _humans_**— the relay pairs exactly two sockets per room.
- **Spectating / replay UI** — worth flagging as a _cheap future bonus_
  though: a match here is fully reconstructable from `seed + the ordered
command log`, both of which already exist in this design, so recording one
  to a file is nearly free once the core loop works.

## Where the pieces live

The repo is an npm-workspaces monorepo. Online play spans five of them, and the
dependency direction is one-way — each may only import from the ones above it:

| Workspace   | Its part in a networked match                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`    | The vocabulary both the game and the wire boundary speak: `Command`, `DroneControl`, the enums. Zero dependencies.                        |
| `protocol/` | `schema/messages.bare` + its committed codegen, and the framing/handshake constants. Shared with the relay.                               |
| `net/`      | `LockstepSession` (transport), `wire/codec/` (shape + mapping), `wire/validation/` (meaning). Depends on the two above and nothing else. |
| `client/`   | The game. `GameApp.step()` consults `LockstepSession` before ticking; `config/multiplayer.ts` injects the relay URL and world bounds.     |
| `server/`   | The relay Worker + `Room` Durable Object.                                                                                                 |

The client-side pieces the online path touches:

| Path                                         | Its job                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `client/src/pixi/GameApp.ts`                 | Owns the session; `step()` advances a net tick only when both sides' input for it has arrived.                 |
| `client/src/config/multiplayer.ts`           | The one place that knows both the game config and `net` — supplies `LockstepConfig`.                           |
| `client/src/engine/worldHash.ts`             | The desync probe. Lives in the engine because it hashes the ECS world; `net` never sees a world, only numbers. |
| `client/src/engine/game/context.ts`          | `createGameContext` takes the shared seed as a parameter instead of calling `Date.now()`.                      |
| `client/src/engine/game/scenes/gameScene.ts` | Builds the world from `ctx.roster`, so `aiSystem` needs no online gate.                                        |
| `client/src/store/gameStore.ts`              | `localSide` + lobby status (`connecting`/`hosting`/`inMatch`/`ended`/`error`) and actions.                     |
| `client/src/ui/screens/OnlineLobby.tsx`      | Create/join-room screen, wired from `MainMenu.tsx`.                                                            |
| `client/src/ui/hooks/usePauseHotkey.ts`      | Disabled while online — pause is not synchronized.                                                             |

## How to run (dev)

1. Start the relay locally: `npm run dev -w server` (wrangler/miniflare on
   `ws://localhost:8787`, no Cloudflare login needed).
2. Run the client: `npm run dev` — `VITE_MULTIPLAYER_URL` defaults to
   `ws://localhost:8787` in dev.
3. Open two browser tabs → **Online (2P)** in the menu. Host in one (share the room
   code), join with it in the other. Both simulate the same match; each player sees
   their own side in the friendly colour.

Deploy: `npm run deploy -w server` (after `npx wrangler login`), then build the
client with `VITE_MULTIPLAYER_URL=wss://<your-worker-host>` so the static GitHub
Pages build talks to the deployed relay. Re-check Cloudflare's current free-tier
Durable Objects / WebSocket limits before relying on it.

The relay has an end-to-end check (two `WebSocket` clients against `wrangler dev`):
create → `created`, join → matching `start` seed on both, `tick` relay,
`opponentLeft` on disconnect, plus the `room-not-found` / `version-mismatch` paths.

## Remaining / not built

- **Reconnection**, **spectating / replay**, **>2 humans** — out of scope.
- **i18n** — the lobby strings are English-only for now.
