# Multiplayer over WebSocket

Two-human online matches over a thin WebSocket relay (bots may fill the other
seats — see "Bots online" below). **Implemented** — this documents how it works.
Constraints fixed going in:

- **UI stays static** — no server rendering; the backend is a separate service on
  its own hostname (`.docs/deployment.md`).
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
  networked and deterministic. A base's rally point goes the same way, as
  `SetRallyPoint` — it is base state that changes what production does, so it has
  to be applied on the same tick by both peers, not held locally in the HUD. So
  does the base's one-shot energy dome, as `ActivateShield`: it decides what the
  next twenty seconds of damage do, and a peer that raised it a tick later would
  be playing a different match. And so does the directive a base stamps on the
  robots it builds, as `SetDefaultTask` — the pre-game base setup rides it into a
  networked match, which is why the setting survives with auto-production off.)

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

Online matches force `Difficulty.Normal` (clamped once in `createGameContext`).
Difficulty scales the bots' economy, and it never crosses the wire — `StartMessage`
carries no field for it, so a value only one peer knew would desync both worlds.

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
byte 0    MessageTag — game:  Tick 0, Created 1, Start 2, OpponentLeft 3, Error 4
                       chat:  ChatSend 5, ChatHistory 6, ChatPosted 7, ChatPresence 8
byte 1+   the BARE-encoded body of that message (empty for opponentLeft)
```

The chat tags share the numbering but never the socket — see
[Chat](#chat-a-second-socket-to-a-second-object) below. `Room.relay` whitelists
`Tick`, so one arriving on a game socket is dropped, and `net`'s decoder throws on
one for the mirror-image reason.

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
- resume: `?room=<CODE>&v=<PROTOCOL_VERSION>&resume=<RESUME_TOKEN>` — a dropped
  seat reclaiming itself (see [Surviving a disconnect](#surviving-a-disconnect))

The Worker routes each upgrade to the Durable Object `idFromName(room)`. Messages
after that:

| Direction                     | Tag / message                                         | Purpose                                                                                                                      |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Relay → host                  | `1` `CreatedMessage { roomCode }`                     | Room open, waiting for a guest.                                                                                              |
| Relay → both                  | `2` `StartMessage { seed, mapSize, aiCount, chatId, resumeToken }` | Sent once the room has 2 sockets — shared seed + match setup; fires `startMatch`. `chatId` is opaque to the game (see Chat). `resumeToken` is **per seat**, so these two frames are not byte-identical. |
| Client → relay → other client | `0` `TickMessage { tick, commands, drone, check?, pauseToggle }`   | One sim tick's commands **+ the sender's drone input**, plus the shared-pause pulse; the DO rebroadcasts the bytes verbatim. |
| Relay → remaining client      | `3` (no payload)                                      | The peer left, or its seat's grace period expired — the match is over.                                                       |
| Relay → client                | `4` `ErrorMessage { code, message }`                  | Join/version failures (`ROOM_NOT_FOUND` / `ROOM_FULL` / `ROOM_TAKEN` / `VERSION_MISMATCH` / `RESUME_REJECTED`).              |

The `Room` Durable Object's whole job: hold up to 2 sockets, generate the seed
(`crypto.getRandomValues`) once the second connects, forward each `tick` to the
other socket, hold a dropped seat open for its grace period, and send
`opponentLeft` once it is really over. No game logic, no persistence.

### Surviving a disconnect

A dropped socket used to end the match outright. It no longer does, and the reason
it can be cheap is the stall above: **under lockstep a peer with no connection does
not fall behind**, because neither world advances without both sides' input for the
current tick. Nothing has to be rewound or caught up — only re-delivered.

So the relay holds the seat for `RESUME_GRACE_MS` (20s) and keeps the frames aimed
at it in a bounded ring (`RESUME_BUFFER_FRAMES`), still as the opaque bytes it was
already forwarding. The client's `LockstepSession` keeps its own outbox of sent
ticks, re-attaches with `?resume=<token>`, and replays whatever the peer has not
acknowledged — and the peer's own tick stream _is_ that acknowledgement, since it
could not have reached tick N without our input for `N - INPUT_DELAY_TICKS`. The
surviving client needs no new behaviour at all: it stalls, exactly as it does for
lag, and its HUD says `reconnecting` instead of looking crashed
(`online.link` in the store). Only when the grace period expires does the relay
send `opponentLeft`.

The seat is named by a **`resumeToken`** — 128 bits issued per seat in `start` —
and not by the room code, which is four client-generated characters and far too
guessable to protect a live match. An unknown or expired token gets
`RESUME_REJECTED` rather than any other kind of join.

### Pausing a networked match

The pause is one bit of tick input (`pauseToggle`), so it lands on the same tick in
both simulations and needs no message of its own. It is a **pulse**, not a state:
either side may flip it and either may flip it back, and two pulses on one tick are
two flips — which composes to the same world on both peers regardless of the order
they are applied in. `GameApp.stepOnline` derives the shared flag from the pair and
hands it to `engine.setPaused`; the per-tick heartbeat keeps running while paused,
which is the only reason the pause can ever be lifted. Local input is dropped while
it holds (a stopped world is a break, not free thinking time), and that is a
sender-side policy — each peer decides it about its own input, so it cannot desync
anything.

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
  which legitimately differs per client. Timed status effects belong in it for the
  same reason positions do: peers that disagree on who is currently disabled by a
  directed-energy hit will disagree on where everyone is one tick later, so the
  hash carries the remaining knock-out time alongside position, hp and program.
  A base's energy dome is in there too, and it is the case that shows why the rule
  is about *state*, not about hp: the dome exists precisely to stop hp from
  moving, so a peer whose dome is a little stronger, or a little older, or already
  spent, shows nothing at all through hp until the base dies on one side only.
  Both its axes and the spent flag are hashed.

## Chat: a second socket to a second object

Players in an online match can talk to each other. The requirement that shapes the
whole design is that **chat outlives the match** — it survives the opponent
leaving, the return to the menu, a page reload, and a visit days later.

That rules out putting it in the lockstep stream. `Room` is two-socket and
match-lifetime by construction; a conversation hung off it would end with the
match, and a reload would lose it outright. So chat gets its **own WebSocket to
its own Durable Object**, addressed by a relay-issued opaque `chatId` — 128 bits
of randomness, unrelated to the 4-character room code — which both peers learn in
`StartMessage`, the one instant they are told the same thing at the same time.

- **Reached only from an existing network match.** No lobby chat, no chat in solo
  or AI games, no discovery by code.
- **Identified by seat**, "You" / "Opponent". There are no nicknames in this game.
- **Retention is 7 days from the last message** — every post re-arms the alarm.
- The panel floats over the canvas and is mounted **outside** `App`'s `inMatch`
  guard, which is the UI half of the same property.

Two things about the chat stack are deliberately unlike `net`, and both are
written up in [`chat/README.md`](../chat/README.md):

- **The chat Durable Object decodes what it is sent.** It has to — it assigns
  sequence numbers, stores history and caps the log. `Room`'s content-blindness is
  about relaying a lockstep tick it has no business understanding; it does not
  generalize to a different object with a different job.
- **Validation is asymmetric.** `net`'s hard rule (`scheduleLocal` screens the
  local batch too) exists because under lockstep an asymmetric filter _is_ a
  desync. Chat touches no simulation, so the server is simply authoritative: it
  sanitizes and rate-limits, the client runs the same `sanitizeChatText` on its own
  outgoing text, and a disagreement costs a re-render at worst.

| Direction     | Tag / message                                    | Purpose                                                          |
| ------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Client → Chat | `5` `ChatSendMessage { text }`                   | Sanitized, rate-limited and numbered server-side.                |
| Chat → client | `6` `ChatHistoryMessage { entries, peerOnline }` | On connect: everything after the `since` the client asked for.   |
| Chat → both   | `7` `ChatPostedMessage { entry }`                | A new message; the sender's own echo is what confirms its `seq`. |
| Chat → client | `8` `ChatPresenceMessage { peerOnline }`         | The other seat attached or dropped.                              |

Connection, as always, is query params: `/chat?chat=<ID>&seat=<host|guest>&since=<SEQ>&v=<VERSION>`.
`since` is the highest `seq` the client already has, so a reconnect costs the gap
rather than the log — which is what makes reconnecting cheap enough to do on every
backoff tick (1s → 2s → 4s → … → 30s).

**Typing must not play the game.** Every hotkey listens on `window` and calls
`preventDefault()`, so without a guard a message would pause the match, select the
army, recall control groups and fly the drone. `client/src/utils/isTypingTarget.ts`
is that guard, and all four listeners (three hooks plus `pixi/input/pointer.ts`)
bail out on it.

## Explicitly out of scope

- **Rejoining a match that really ended** — the resume flow above covers a
  dropped socket inside its grace period, nothing beyond it: once `opponentLeft`
  is sent the room is gone, and there is no lobby to re-enter or state to restore.
- **Anti-cheat / hiding fog-of-war state from the client** — accepted
  limitation of lockstep, see above.
- **More than 2 _humans_**— the relay pairs exactly two sockets per room.
- **Spectating / replay UI** — worth flagging as a _cheap future bonus_
  though: a match here is fully reconstructable from `seed + the ordered
command log`, both of which already exist in this design, so recording one
  to a file is nearly free once the core loop works.

## Where the pieces live

The repo is an npm-workspaces monorepo. Online play spans six of them, and the
dependency direction is one-way — `net` and `chat` are siblings, neither importing
the other:

| Workspace   | Its part in a networked match                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `types/`    | The vocabulary both the game and the wire boundary speak: `Command`, `DroneControl`, the enums. Zero dependencies.                       |
| `protocol/` | `schema/messages.bare` + its committed codegen, and the framing/handshake constants. Shared with the relay.                              |
| `net/`      | `LockstepSession` (transport), `wire/codec/` (shape + mapping), `wire/validation/` (meaning). Depends on the two above and nothing else. |
| `chat/`     | `ChatSession` + its codec/validation. A sibling of `net` under the same rules; carries the conversation, never the simulation.           |
| `client/`   | The game. `GameApp.step()` consults `LockstepSession` before ticking; `config/multiplayer.ts` injects the relay URL and world bounds.    |
| `server/`   | The relay Worker, the `Room` Durable Object, and the `Chat` one.                                                                         |

The client-side pieces the online path touches:

| Path                                         | Its job                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `client/src/pixi/GameApp.ts`                 | Owns the session; `step()` advances a net tick only when both sides' input for it has arrived.                 |
| `client/src/config/multiplayer.ts`           | The one place that knows both the game config and `net` — supplies `LockstepConfig`.                           |
| `client/src/engine/worldHash.ts`             | The desync probe. Lives in the engine because it hashes the ECS world; `net` never sees a world, only numbers. |
| `client/src/engine/game/context.ts`          | `createGameContext` takes the shared seed as a parameter instead of calling `Date.now()`.                      |
| `client/src/engine/game/scenes/gameScene.ts` | Builds the world from `ctx.roster`, so `aiSystem` needs no online gate.                                        |
| `client/src/store/gameStore.ts`              | `localSide` + lobby status (`connecting`/`hosting`/`inMatch`/`ended`/`error`) and actions.                     |
| `client/src/ui/screens/OnlinePanel.tsx`      | Create/join-room panel — the title screen's Multiplayer tab, not a dialog (see `MainMenu.tsx`).                |
| `client/src/ui/hooks/usePauseHotkey.ts`      | Disabled while online — pause is not synchronized.                                                             |
| `client/src/chat/chatBridge.ts`              | Owns the `ChatSession`. Outside `pixi/` on purpose — it must not die with the match.                           |
| `client/src/chat/chatStorage.ts`             | The chat addresses this browser knows. Without it a reload loses a chat the server still holds.                |
| `client/src/ui/hud/ChatPanel.tsx`            | The floating panel, mounted outside `App`'s `inMatch` guard.                                                   |
| `client/src/utils/isTypingTarget.ts`         | The guard every `window` hotkey runs first, so typing a message doesn't play the game.                         |

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
