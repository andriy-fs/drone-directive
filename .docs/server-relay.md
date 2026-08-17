# The relay server (`@drone-directive/server`)

How the backend half of online multiplayer is built. This is the **implementation**
reference for `server/**`; the surrounding design (why lockstep, the client-side
tick loop, determinism) lives in [multiplayer.md](./multiplayer.md), and the
CI/Cloudflare setup in [deployment.md](./deployment.md).

**One-line summary:** a Cloudflare Worker that upgrades WebSockets and hands each
one to a Durable Object named after the room code; that object holds two seats,
mints one shared RNG seed, forwards `tick` frames between them, and holds a
dropped seat open long enough for it to come back. It runs **no game code and
stores nothing.**

## Why there is a server at all

Lockstep clients simulate the whole match themselves — they only need each other's
per-tick input. So the backend exists for exactly three things browsers can't do
peer-to-peer without a lot more machinery:

1. **Rendezvous** — turn a 4-character room code into "these two sockets".
2. **One shared seed** — both clients must build the identical world, so somebody
   neutral has to pick the number ([multiplayer.md § determinism](./multiplayer.md#determinism-prerequisites)).
3. **Message forwarding** — a dumb pipe between the two peers.

Everything else was deliberately kept out. That is what lets the whole backend be
~120 lines across two files.

## Runtime shape: Worker + one Durable Object per room

```
browser (host)  ─┐                          ┌─ Worker.fetch()  ── stateless router
                 ├─ wss://…/?room=AB7K&… ───┤     idFromName("AB7K")
browser (guest) ─┘                          └─→ Room DO "AB7K"  ── holds both sockets
```

Two pieces, split by whether they need memory:

| File                                            | Role                                                                                                              |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`server/src/index.ts`](../server/src/index.ts) | Worker entry. Stateless: health check, upgrade check, route by path — `/chat` to `CHAT`, anything else to `ROOM`. |
| [`server/src/Room.ts`](../server/src/Room.ts)   | The `Room` Durable Object. All pairing, the seed, relaying, teardown.                                             |
| [`server/src/Chat.ts`](../server/src/Chat.ts)   | The `Chat` Durable Object. One conversation: history, presence, retention. See [Chat](#the-chat-durable-object).  |

**Why a Durable Object and not plain Worker state.** Worker invocations are
stateless and can land on any machine worldwide, so two players hitting the same
URL would generally get two unrelated isolates — there is nowhere to keep "the
host's socket" between them. A Durable Object is the opposite: `idFromName(code)`
maps a string to exactly **one** globally-unique, single-threaded instance, and
every request for that name is routed to it. That gives the room three properties
the design leans on hard:

- **Both sockets land in the same object**, so `this.host` / `this.guest` are just
  instance fields.
- **Single-threaded execution** — no locking around the pairing logic, and no race
  where two guests both pass the `if (this.guest)` check.
- **Rooms are isolated** — one room's traffic can't touch another's, and one room
  crashing doesn't affect others.

The Worker stays stateless on purpose: it's the cheap, globally-distributed part,
and all it does is pick which DO to talk to.

## The room's state machine

`Room` holds two seats and the match setup, all in memory, none persisted:

```ts
private readonly host = new Seat();          // first socket, arrived with create=1
private readonly guest = new Seat();         // second socket
private roomCode = '';                       // echoed back in `created`
private mapSize: MapSize = MapSize.Medium;   // the host's pick, forwarded in `start`
private started = false;                     // both seats taken and `start` sent
```

A `Seat` is the part that outlives its socket: the socket itself, the
`resumeToken` that names the seat, the frames held while it is away, and the grace
timer. That split is the whole of the reconnection feature —
`this.host.ws` changes, `this.host` does not.

```
   (empty) ──host connects──▶ hosting ──guest connects──▶ paired ──either closes──▶ (empty)
      │                          │                          │
      └─guest first─▶ error      └─2nd create ─▶ error       └─3rd socket ─▶ error
        room-not-found             room-taken                  room-full
```

The empty state is reachable again after a match: `onClose` nulls **both** slots,
so the same room code can be re-hosted later. The DO instance itself survives (the
name→id mapping is permanent) — it's just back to zero sockets. There is no
"match in progress" flag; `host && guest` _is_ that state.

## Connection lifecycle, step by step

### 1. Upgrade and routing (Worker)

A WebSocket must choose its room _before_ it opens — there is no message channel
yet — so create/join intent travels as query params. The client builds the URL in
[`net/src/config.ts`](../net/src/config.ts) (`connectUrl`),
the constants are shared via `@drone-directive/protocol`:

- host: `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>`
- guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`
- resume: `?room=<CODE>&v=<PROTOCOL_VERSION>&resume=<RESUME_TOKEN>`

`Worker.fetch` then does five things and nothing else: answers `GET /health` with
`ok`, rejects non-upgrade requests with **426**, routes `/chat` to
`env.CHAT.get(idFromName(chatId))` (**400** on a missing or too-short id), rejects a
missing `?room=` with **400**, and otherwise forwards the untouched request to
`env.ROOM.get(idFromName(roomCode))`.

The room code is generated **client-side** by the host (`randomRoomCode()`, 4 chars
from an alphabet with no `0/O/1/I`) — the server never allocates codes, it just
uses whatever string it's given as a DO name.

### 2. Handshake (Durable Object)

`Room.fetch` creates a `WebSocketPair`, calls `server.accept()`, and returns the
client half with status **101**. Then, in order:

1. **Version gate first.** `v` must equal `PROTOCOL_VERSION`, else
   `error: version-mismatch`. Checking before the create/join branch means an
   outdated client can never occupy a room slot.
2. **`resume=<token>` → `acceptResume`, before either of the below.** The token
   names the seat as well as proving the right to it, so a match on a seat still
   inside its grace period adopts the new socket and replays what it missed;
   anything else is `resume-rejected` rather than some other kind of join.
3. **`create=1` → `acceptHost`.** Refuses with `room-taken` if a host is already
   there; otherwise stores the socket, maps the `mapSize` query param to its schema
   tag (falling back to `medium` on anything else — the only input validation in
   the whole server, and the only place it still handles text), and replies
   `created` so the lobby can show the code.
4. **no `create` → `acceptGuest`.** Refuses with `room-not-found` if no host is
   waiting, `room-full` if the room already has two, otherwise stores the socket
   and calls `start()`.

### 3. `start` — the seed handoff

```ts
const seed = crypto.getRandomValues(new Uint32Array(1))[0];
```

One CSPRNG draw, sent identically to both sockets alongside the host's `mapSize`.
This is the **only value the server ever originates** that both peers share, and
it's the linchpin of the whole design: both clients feed it to
`GameEngine.startMatch(settings, seed)` and build byte-identical worlds — same
obstacles, same base placement, same entity ids.

The same message carries two more relay-minted values, and the second is why the
two `start` frames are no longer byte-identical: the opaque `chatId` (the same for
both) and a **per-seat `resumeToken`** (128 bits each). Reconnection has to be
something only a seat's own holder can do, and the room code — four characters,
typed by a human, guessable — could never carry that weight.

### 4. Relaying

```ts
if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return;
if (new Uint8Array(data, 0, 1)[0] !== MessageTag.Tick) return;
const peer = from === this.host ? this.guest : this.host;
peer?.send(data);
```

Note it forwards `data` — the **original bytes**, not a re-encoded message. The
frame's leading octet is the message tag, deliberately placed _outside_ the BARE
payload so this can be a one-byte read: the relay decides what to do with a frame
without ever decoding one. Anything that isn't binary, is empty, or isn't tagged
`Tick` is dropped silently rather than answered with an error — a relay that
argues with malformed input is just more surface area, and a correct client never
sends any.

The relay is entirely **content-blind**. It does encode the four messages it
originates (`created`/`start`/`opponentLeft`/`error`), so the generated codec is
in its bundle — but only the writers for those four: tree-shaking leaves out every
reader and the whole `Command` graph, which is checkable with
`npx wrangler deploy --dry-run --outdir …`. It never learns what a robot is.

### 5. A dropped seat, and teardown

`close` and `error` both route to `onClose`. Before the match starts it ends the
room outright, as it always did. Mid-match it does something else: the seat is
marked `awaiting`, a `setTimeout` for `RESUME_GRACE_MS` (20s) is armed, and every
frame `relay()` would have forwarded to that seat is pushed onto a bounded ring
instead (`RESUME_BUFFER_FRAMES`, still the same opaque bytes — nothing is decoded
to hold it). The surviving socket is left completely alone: under lockstep it
cannot advance without the missing peer's input anyway, so it simply stalls, which
is what it already does for lag.

A socket arriving with that seat's token inside the window is adopted, given the
held frames **in order**, and the live stream picks up behind them. If the timer
fires first, `endMatch` does what `onClose` used to: `opponentLeft` to whoever is
left, closed with code **1000**, both seats cleared.

The grace period runs on a plain `setTimeout` rather than a DO alarm on purpose.
The surviving socket keeps this object in memory for the whole window, and if both
sides are gone there is nobody left to notify — so the timer never has to outlive
the instance, and the room stays free of storage.

One deliberate subtlety: **rejected sockets never get listeners.** `wire()` runs
only after a socket passes the checks in `acceptHost`/`acceptGuest`, so a
version-mismatched or `room-full` connection closing does _not_ fire `onClose` and
cannot tear down a healthy room. Rejects close with **1008** (policy violation),
normal endings with **1000**.

## Wire protocol reference

Messages: [`protocol/schema/messages.bare`](../protocol/schema/messages.bare),
compiled to `protocol/src/generated/messages.ts` (committed — this workspace has
no build step). Handshake constants and framing:
[`protocol/src/index.ts`](../protocol/src/index.ts), which stays dependency-free
so this Worker can route a frame without linking a decoder. `PROTOCOL_VERSION` is
bumped on any change to the schema — BARE has no field numbers, so every change is
breaking — and enforced at connect time.

Each frame is one `MessageTag` octet followed by that message's BARE payload:

| Tag | Direction             | Message                                         | Sent when                                                                          |
| --- | --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `1` | Relay → host          | `CreatedMessage { roomCode }`                   | Room opened, waiting for a guest.                                                  |
| `2` | Relay → both          | `StartMessage { seed, mapSize, aiCount, chatId, resumeToken }` | Second socket joined. Triggers `startMatch`. `resumeToken` differs per seat.       |
| `0` | Client → relay → peer | `TickMessage { tick, commands, drone, check?, pauseToggle }`   | Every sim tick, forwarded verbatim (heartbeat even when empty).                    |
| `3` | Relay → survivor      | _(no payload — the tag byte alone)_             | Peer left, or its seat's grace period expired.                                     |
| `4` | Relay → client        | `ErrorMessage { code, message }`                | `ROOM_NOT_FOUND` · `ROOM_FULL` · `ROOM_TAKEN` · `VERSION_MISMATCH` · `BAD_MESSAGE` · `RESUME_REJECTED` |

`BAD_MESSAGE` is declared in the schema but never sent by the relay — the client
uses it locally for a malformed `VITE_MULTIPLAYER_URL` (`LockstepSession.open`).

## Configuration

[`server/wrangler.toml`](../server/wrangler.toml) is the whole deployment config:

- `name = "drone-directive-relay"`, reached at `wss://relay.drone-directive.space`
  via the `[[routes]]` `custom_domain` entry. Its own hostname, not the game's:
  the relay routes a match at the **root path**, where the static site's
  `index.html` lives (`.docs/deployment.md` has the full reasoning). `workers.dev`
  is disabled as a side effect of declaring a route.
- One DO binding, `ROOM` → `class_name = "Room"` (which is why `Room` is re-exported
  from the Worker entry — wrangler needs it as a named export of `main`).
- `[[migrations]] new_sqlite_classes = ["Room"]`. **The relay never touches
  storage**; SQLite-backed classes are simply what Cloudflare's free plan requires
  for Durable Objects, so the declaration is a formality.

`server/tsconfig.json` type-checks against `@cloudflare/workers-types` and mirrors
the client's strictness (`strict`, `verbatimModuleSyntax`, `noUnused*`) so the same
conventions apply here — `import type` for type-only imports, const-map unions
preferred over TS `enum` in hand-written code.

## Operating it

```bash
npm run dev -w server         # local relay (wrangler/miniflare) on ws://localhost:8787 — no login
npm run type-check -w server  # tsc --noEmit; NOT part of the root `npm run build`
npm run deploy -w server      # wrangler deploy (needs `npx wrangler login` once)
```

The root `npm run lint` covers this workspace, and `npm run type-check` chains
`types`/`net`/`server`. What it is **not** covered by is `npm run build`: the
server has no build step (wrangler bundles `src/index.ts` directly) and nothing
here is reached by `npx tsc -b` in `client/`. So after editing `server/**` or
`protocol/**`, run `npm run type-check` — a green client build proves nothing
about the relay.

After editing `protocol/schema/messages.bare`, run `npm run codegen -w protocol`
and commit the regenerated `protocol/src/generated/messages.ts` — nothing in CI
does it for you.

The client picks the relay at **build time** via `VITE_MULTIPLAYER_URL` (the UI is
a static Pages site), defaulting to `ws://localhost:8787`. CI deploys the Worker
from `.github/workflows/deploy.yml` (`deploy-worker` job, authenticating from
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) in parallel with the Pages build
— they share only that URL, which is stable, so no ordering dependency.

### Testing

`npm test` runs Vitest in `net` and `client`; neither reaches the relay, so it has
its own end-to-end script — two `WebSocket` clients driven through
create → `created` → join → byte-identical `start` → `tick` relay → `opponentLeft`,
plus the `room-not-found` and `version-mismatch` rejections. It needs a listening
relay, which is why it is a separate command rather than part of `npm test`:

```bash
npm run dev -w server   # one terminal
npm run e2e -w server   # another
```

[`server/scripts/relay-e2e.mjs`](../server/scripts/relay-e2e.mjs) imports nothing
from the workspace and asserts on raw frame bytes, so it tests the wire rather
than the client's idea of the wire — the message tags in it are pinned literals on
purpose. Its one concession is reading `PROTOCOL_VERSION` out of the protocol
source, since a stale copy would fail every connection and look like a relay bug.

Then verify the game itself by hand:

1. Two tabs on `npm run dev` → **Online (2P)**; host in one, join by code in the
   other. Both should start and stay in sync.
2. Close one tab → the other reports the opponent left and returns to the menu.
3. Join a code nobody is hosting → `room-not-found` in the lobby.

## Why the room DO stays resident

(`Chat` makes the opposite call, for the opposite reason — see below.)

`Room` uses `server.accept()`, not the WebSocket **Hibernation** API
(`state.acceptWebSocket()`). The difference matters for correctness here: with
plain `accept()` the object cannot be evicted while its sockets are open, so the
in-memory `host` / `guest` fields are guaranteed to survive the whole match. That
is exactly what makes the zero-persistence design safe.

The trade-off is billing/lifetime: the object stays resident for the match's wall
duration instead of sleeping between messages. For a 30 Hz lockstep game with
traffic every tick that's the right call — hibernation pays off for idle
connections, and these are never idle. Switching to hibernation later would mean
moving `host`/`guest` into DO storage or reconstructing them from
`state.getWebSockets()`, plus handling wake-ups — real work, not a flag flip.

## The Chat Durable Object

`Chat` is the second object in this Worker and shares nothing with `Room` but the
protocol. A different address (the opaque `chatId` `Room` issues in
`StartMessage`, hex of 16 random bytes), a different socket (`/chat`), and — the
reason it exists at all — **a different lifetime**: a conversation outlives the
match that created it, by up to `CHAT_RETENTION_MS` (7 days from the _last_
message). See [multiplayer.md](./multiplayer.md#chat-a-second-socket-to-a-second-object).

**It decodes what it is sent, and `Room` does not.** That is not an inconsistency.
`Room`'s content-blindness is about relaying a lockstep tick it has no business
understanding; `Chat` has to read a message to assign it a sequence number, store
it and cap the log. Nothing it decodes is a simulation input.

**Hibernatable from day one** — the opposite call from `Room`, and for the
opposite reason. Sockets are accepted with `ctx.acceptWebSocket(server, [seat])`,
using the seat as the hibernation tag, so `ctx.getWebSockets('host'|'guest')`
finds the peer with no in-memory state to lose. A chat is idle almost all of the
time (that is the whole point of a week's retention), which is exactly the case
hibernation is for. It also forces one thing that is easy to get wrong: the
**rate-limit counters live in `ws.serializeAttachment()`**, because an in-memory
counter is lost the moment the object sleeps — a flood window anyone could open by
waiting.

State is `ctx.storage.sql`: `messages(seq INTEGER PRIMARY KEY, seat INTEGER, text
TEXT, sent_at INTEGER)`, pruned to `CHAT_HISTORY_LIMIT` after every insert, with
`alarm()` → `storage.deleteAll()` for retention. Every post re-arms the alarm, so
an active conversation is never erased under the players.

**Access is capability-based, and that is a deliberate limitation.** Anyone
holding a `chatId` can attach as either seat — the object authenticates nothing.
With a 128-bit id issued by the relay, delivered only inside `StartMessage`, and
never displayed anywhere, that is the right trade for a two-person chat: the
alternative is accounts, which this game does not have and does not want. Worth
knowing rather than discovering: a leaked `chatId` is full read/write access to
that conversation until retention expires.

## Deliberate non-goals

The relay does **not**, and is not meant to:

- **Validate game commands.** It cannot — a tick's payload is bytes it never
  decodes, and the server has no world to check them against. Validation happens
  peer-side, in two layers inside [`@drone-directive/net`](../net): the generated
  BARE codec rejects anything that isn't a well-formed message, and
  `wire/validation/` (valibot) rejects anything whose _values_ make no sense in
  this match. Ownership is a third check, `isCommandFrom` in
  [`client/src/engine/systems/commands.ts`](../client/src/engine/systems/commands.ts),
  applied to both the local and the peer's batch in `GameApp.stepOnline`. All
  three run identically on both peers, which is required — an asymmetric filter
  would itself desync the match. Together they stop honest-client bugs and
  malformed input; they do **not** stop a modified client that sends
  well-formed lies. Real enforcement would require a server-authoritative
  simulation.
- **Hide anything.** Each client simulates the full world including the fog-hidden
  opponent — the classic lockstep-RTS limitation, accepted by design.
- **Detect desync.** The clients do that themselves: a periodic world hash rides
  on the `tick` message the relay already forwards verbatim, so the relay stays
  ignorant of game state (see [multiplayer.md](./multiplayer.md)).
- **Rejoin a match that has actually ended.** Holding a dropped seat for 20s is
  re-delivery, not a lobby: once `opponentLeft` is sent there is nothing to come
  back to.
- **Support spectators, or more than 2 human players.** (Bots need no socket —
  both clients simulate them from the shared seed; the relay only carries the
  host's `aiCount` in `start`.)
- **Authenticate, rate-limit, or match-make.** Anyone who guesses a 4-character
  code can join a room that's still waiting. Rooms are ephemeral and the code space
  is small by design (it has to be typeable) — acceptable for a hobby game, worth
  revisiting before anything public-facing.
- **Persist.** No storage, no logs, no match history. A room's whole existence is
  two seats and a seed, and a seat held for a dropped player lives in memory too —
  if the object itself goes, so does the seat.
