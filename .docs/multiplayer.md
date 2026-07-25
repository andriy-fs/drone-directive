# Multiplayer over WebSocket

2-player online matches over a thin WebSocket relay. **Implemented** — this
documents how it works. Constraints fixed going in:

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
  `Command`s (`client/src/types/commands.ts`) that `commandsSystem.ts` drains and
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

- **Ownership is fixed and shared.** `Owner.Player` is one corner, `Owner.AI` the
  other, on both clients (base placements unchanged). The **host controls
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

The one sim change: `aiSystem(ctx, dt)` (the bot) is **skipped** when `ctx.online`
— `Owner.AI` is a real opponent. Online matches also use symmetric Normal starter
counts for both sides (the asymmetric Easy/Hard presets only make sense vs a bot).

**Known limitation, accepted:** each client simulates the entire world (including
the fog-hidden opponent), so a client could inspect it via devtools — the classic
lockstep-RTS issue. Fixing it needs server-authoritative simulation, the heavier
alternative this design opts out of.

## Wire protocol

Kept intentionally thin — the Durable Object understands no game rules, it just
pairs two sockets and relays bytes. The message + connection types live in the
shared **`@drone-directive/protocol`** workspace (`protocol/src/index.ts`),
imported by both the client and the Worker.

A WebSocket must target its room before it opens, so create/join intent travels
as **URL query params**, not messages (the host generates the room code
client-side, from an unambiguous alphabet):

- host: `?room=<CODE>&create=1&v=<PROTOCOL_VERSION>&mapSize=<small|medium|large>`
- guest: `?room=<CODE>&v=<PROTOCOL_VERSION>`

The Worker routes each upgrade to the Durable Object `idFromName(room)`. Messages
after that:

| Direction                     | Message                                      | Purpose                                                                                    |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Relay → host                  | `{ type: 'created', roomCode }`              | Room open, waiting for a guest.                                                             |
| Relay → both                  | `{ type: 'start', seed, mapSize }`           | Sent once the room has 2 sockets — shared seed + map size; fires `startMatch`.             |
| Client → relay → other client | `{ type: 'tick', tick, commands, drone }`    | One sim tick's commands **+ the sender's drone input**; the DO rebroadcasts it verbatim.   |
| Relay → remaining client      | `{ type: 'opponentLeft' }`                   | On disconnect — the match ends (no reconnection).                                          |
| Relay → client                | `{ type: 'error', code, message }`           | Join/version failures (`room-not-found` / `room-full` / `room-taken` / `version-mismatch`). |

The `Room` Durable Object's whole job: hold up to 2 sockets, generate the seed
(`crypto.getRandomValues`) once the second connects, forward each `tick` to the
other socket, and send `opponentLeft` on disconnect. No game logic, no persistence.

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
2. `LockstepSession` (`client/src/pixi/net/LockstepSession.ts`) buffers both the
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
- **Still TODO (not built):** a per-N-ticks state checksum in the `tick` message to
  catch a desync and end the match cleanly instead of silently drifting.

## Explicitly out of scope

- **Pause** — not synchronized; the in-match pause hotkey and button are disabled
  online (`usePauseHotkey.ts` + `PauseButton`, gated on `online.status`).
- **Reconnection** — a dropped socket ends the match (`opponentLeft`); no
  resume/rejoin flow.
- **Anti-cheat / hiding fog-of-war state from the client** — accepted
  limitation of lockstep, see above.
- **More than 2 players.**
- **Spectating / replay UI** — worth flagging as a _cheap future bonus_
  though: a match here is fully reconstructable from `seed + the ordered
command log`, both of which already exist in this design, so recording one
  to a file is nearly free once the core loop works.

## New / changed files

The repo is now an npm-workspaces monorepo — `client/` (`@drone-directive/client`,
the existing game) and `server/` (`@drone-directive/server`, this backend, currently
a placeholder). Client paths below are workspace-relative (`client/src/…`).

| Path                                           | Change                                                                                                                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/` (workspace scaffolded)               | The `@drone-directive/server` npm workspace already exists as a placeholder. Implement the Cloudflare Worker + Durable Object here with its own `wrangler.toml`; deploy separately via `wrangler deploy`, outside the Vite build.                       |
| `protocol/` (new workspace)                    | New `@drone-directive/protocol` workspace holding the shared wire-message types; both `@drone-directive/client` and `@drone-directive/server` depend on it (avoids cross-workspace source imports).                                                     |
| `client/src/pixi/net/LockstepSession.ts` (new) | WebSocket transport: per-tick command + drone buffering, stall/ready logic, connect host/guest.                                                                                                                                                                         |
| `client/src/pixi/GameApp.ts`                   | `step()` consults `LockstepSession` (when online) before calling `engine.tick()`.                                                                                                                                                                       |
| `client/src/engine/game/scenes/gameScene.ts`   | Gate the `aiSystem(ctx, dt)` call behind `ctx.online`.                                                                                                                                                                                                  |
| `client/src/engine/game/engine.ts`             | `startMatch` accepts an optional external seed.                                                                                                                                                                                                         |
| `client/src/engine/game/context.ts`            | `createGameContext` takes the seed as a parameter instead of calling `Date.now()` internally.                                                                                                                                                           |
| `client/src/config/gameSettings.ts`            | Add an online/match-mode flag to `MatchSettings`. For online matches, force symmetric starter counts (reuse `gameConfig.difficulty.normal` for both sides) rather than exposing the asymmetric Easy/Hard presets — those only make sense against a bot. |
| `client/src/store/gameStore.ts`                | `localSide`, connection/lobby status (`connecting`/`hosting`/`inMatch`/`ended`/`error`) + lobby actions.                                                                                                                                                       |
| `client/src/ui/screens/OnlineLobby.tsx` (new)  | Create/join-room screen, wired from `MainMenu.tsx`.                                                                                                                                                                                                     |
| `client/src/ui/hooks/usePauseHotkey.ts`        | Disabled while `online`.                                                                                                                                                                                                                                |

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

- **Desync detection** — per-tick state checksum (see determinism prerequisites).
- **Reconnection**, **spectating / replay**, **>2 players** — out of scope.
- **i18n** — the lobby strings are English-only for now.
