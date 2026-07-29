# The relay server (`@drone-directive/server`)

How the backend half of online multiplayer is built. This is the **implementation**
reference for `server/**`; the surrounding design (why lockstep, the client-side
tick loop, determinism) lives in [multiplayer.md](./multiplayer.md), and the
CI/Cloudflare setup in [deployment.md](./deployment.md).

**One-line summary:** a Cloudflare Worker that upgrades WebSockets and hands each
one to a Durable Object named after the room code; that object holds two sockets,
mints one shared RNG seed, and forwards `tick` frames between them. It runs **no
game code and stores nothing.**

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

| File                                            | Role                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [`server/src/index.ts`](../server/src/index.ts) | Worker entry. Stateless: health check, upgrade check, read `?room=`, route to the DO. Never touches game data. |
| [`server/src/Room.ts`](../server/src/Room.ts)   | The `Room` Durable Object. All pairing, the seed, relaying, teardown.                                          |

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

`Room` holds four fields, all in memory, none persisted:

```ts
private host: WebSocket | null = null;   // first socket, arrived with create=1
private guest: WebSocket | null = null;  // second socket
private roomCode = '';                   // echoed back in `created`
private mapSize: WireMapSize = 'medium'; // the host's pick, forwarded in `start`
```

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
[`client/src/pixi/net/config.ts`](../client/src/pixi/net/config.ts) (`connectUrl`),
the constants are shared via `@drone-directive/protocol`:

- host: `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>`
- guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`

`Worker.fetch` then does four things and nothing else: answers `GET /health` with
`ok`, rejects non-upgrade requests with **426**, rejects a missing `?room=` with
**400**, and otherwise forwards the untouched request to `env.ROOM.get(idFromName(roomCode))`.

The room code is generated **client-side** by the host (`randomRoomCode()`, 4 chars
from an alphabet with no `0/O/1/I`) — the server never allocates codes, it just
uses whatever string it's given as a DO name.

### 2. Handshake (Durable Object)

`Room.fetch` creates a `WebSocketPair`, calls `server.accept()`, and returns the
client half with status **101**. Then, in order:

1. **Version gate first.** `v` must equal `PROTOCOL_VERSION`, else
   `error: version-mismatch`. Checking before the create/join branch means an
   outdated client can never occupy a room slot.
2. **`create=1` → `acceptHost`.** Refuses with `room-taken` if a host is already
   there; otherwise stores the socket, validates `mapSize` against the allowed
   three (falling back to `medium` on anything else — the only input validation in
   the whole server), and replies `created` so the lobby can show the code.
3. **no `create` → `acceptGuest`.** Refuses with `room-not-found` if no host is
   waiting, `room-full` if the room already has two, otherwise stores the socket
   and calls `start()`.

### 3. `start` — the seed handoff

```ts
const seed = crypto.getRandomValues(new Uint32Array(1))[0];
```

One CSPRNG draw, sent identically to both sockets alongside the host's `mapSize`.
This is the **only value the server ever originates**, and it's the linchpin of the
whole design: both clients feed it to `GameEngine.startMatch(settings, seed)` and
build byte-identical worlds — same obstacles, same base placement, same entity ids.

### 4. Relaying

```ts
if (msg.type !== 'tick') return;
const peer = from === this.host ? this.guest : this.host;
peer?.send(data);
```

Note it forwards `data` — the **original string**, not a re-serialized `msg`. The
parse exists only to read `type`; the payload crosses untouched. Anything that
isn't a string, isn't valid JSON, or isn't a `tick` is dropped silently rather than
answered with an error — a relay that argues with malformed input is just more
surface area, and a correct client never sends any.

The relay is entirely **content-blind**: `TickMessage.commands` is typed
`WireCommand[] = unknown[]` in the protocol package precisely so the server can't
develop an opinion about game commands. It never learns what a robot is.

### 5. Teardown

`close` and `error` both route to `onClose`, which sends `opponentLeft` to the
surviving peer, closes it with code **1000**, and clears both slots. A disconnect
ends the match — there is no reconnection (see [out of scope](#deliberate-non-goals)).

One deliberate subtlety: **rejected sockets never get listeners.** `wire()` runs
only after a socket passes the checks in `acceptHost`/`acceptGuest`, so a
version-mismatched or `room-full` connection closing does _not_ fire `onClose` and
cannot tear down a healthy room. Rejects close with **1008** (policy violation),
normal endings with **1000**.

## Wire protocol reference

Types: [`protocol/src/index.ts`](../protocol/src/index.ts), a types-only workspace
both the client and the Worker depend on, so neither imports the other's source.
`PROTOCOL_VERSION` is bumped on any breaking change and enforced at connect time.

| Direction             | Message                                   | Sent when                                                                          |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------- |
| Relay → host          | `{ type: 'created', roomCode }`           | Room opened, waiting for a guest.                                                  |
| Relay → both          | `{ type: 'start', seed, mapSize }`        | Second socket joined. Triggers `startMatch`.                                       |
| Client → relay → peer | `{ type: 'tick', tick, commands, drone }` | Every sim tick, forwarded verbatim (heartbeat even when empty).                    |
| Relay → survivor      | `{ type: 'opponentLeft' }`                | Peer's socket closed or errored.                                                   |
| Relay → client        | `{ type: 'error', code, message }`        | `room-not-found` · `room-full` · `room-taken` · `version-mismatch` · `bad-message` |

`bad-message` is declared in the protocol but never sent by the relay — the client
uses it locally for a malformed `VITE_MULTIPLAYER_URL` (`LockstepSession.open`).

## Configuration

[`server/wrangler.toml`](../server/wrangler.toml) is the whole deployment config:

- `name = "drone-directive-relay"` → `wss://drone-directive-relay.<SUBDOMAIN>.workers.dev`.
- One DO binding, `ROOM` → `class_name = "Room"` (which is why `Room` is re-exported
  from the Worker entry — wrangler needs it as a named export of `main`).
- `[[migrations]] new_sqlite_classes = ["Room"]`. **The relay never touches
  storage**; SQLite-backed classes are simply what Cloudflare's free plan requires
  for Durable Objects, so the declaration is a formality.

`server/tsconfig.json` type-checks against `@cloudflare/workers-types` and mirrors
the client's strictness (`strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`,
`noUnused*`) so the same conventions apply here — no TS `enum`, `import type` for
type-only imports.

## Operating it

```bash
npm run dev -w server         # local relay (wrangler/miniflare) on ws://localhost:8787 — no login
npm run type-check -w server  # tsc --noEmit; NOT part of the root `npm run build`
npm run deploy -w server      # wrangler deploy (needs `npx wrangler login` once)
```

The root `build` / `test` / `lint` scripts only cover the `client` workspace — the
server has **no build step** (wrangler bundles `src/index.ts` directly) and is not
type-checked by `npx tsc -b` in `client/`. Run `type-check -w server` explicitly
after editing `server/**` or `protocol/**`.

The client picks the relay at **build time** via `VITE_MULTIPLAYER_URL` (the UI is
a static Pages site), defaulting to `ws://localhost:8787`. CI deploys the Worker
from `.github/workflows/deploy.yml` (`deploy-worker` job, authenticating from
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) in parallel with the Pages build
— they share only that URL, which is stable, so no ordering dependency.

### Testing

There is **no automated test for the relay** — `npm test` is Vitest scoped to the
`client` workspace, and nothing under `server/` runs at all. Until something does,
verify by hand against `wrangler dev`:

1. Two tabs on `npm run dev` → **Online (2P)**; host in one, join by code in the
   other. Both should start and stay in sync.
2. Close one tab → the other reports the opponent left and returns to the menu.
3. Join a code nobody is hosting → `room-not-found` in the lobby.
4. `curl http://localhost:8787/health` → `ok`.

A worthwhile addition: a script driving two `WebSocket` clients through
create → `created` → join → matching `start` seed → `tick` relay → `opponentLeft`,
plus the `room-not-found` and `version-mismatch` rejections.

## Why the DO stays resident

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

## Deliberate non-goals

The relay does **not**, and is not meant to:

- **Validate game commands.** It cannot — `commands` is opaque `unknown[]`, and the
  server has no world to check them against. Ownership is enforced **client-side**
  by `isCommandFrom` in [`client/src/engine/systems/commands.ts`](../client/src/engine/systems/commands.ts),
  applied to both the local and the peer's batch in `GameApp.stepOnline`. That
  stops honest-client bugs (it was added after a HUD bug let the guest command the
  host's units), **not** a modified client. Real enforcement would require a
  server-authoritative simulation.
- **Hide anything.** Each client simulates the full world including the fog-hidden
  opponent — the classic lockstep-RTS limitation, accepted by design.
- **Detect desync.** The clients do that themselves: a periodic world hash rides
  on the `tick` message the relay already forwards verbatim, so the relay stays
  ignorant of game state (see [multiplayer.md](./multiplayer.md)).
- **Support reconnection, spectators, or more than 2 human players.** (Bots need
  no socket — both clients simulate them from the shared seed; the relay only
  carries the host's `aiCount` in `start`.)
- **Authenticate, rate-limit, or match-make.** Anyone who guesses a 4-character
  code can join a room that's still waiting. Rooms are ephemeral and the code space
  is small by design (it has to be typeable) — acceptable for a hobby game, worth
  revisiting before anything public-facing.
- **Persist.** No storage, no logs, no match history. A room's whole existence is
  two sockets and a seed.
