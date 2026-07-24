# Multiplayer over WebSocket (plan)

Forward-looking implementation plan for 2-player online matches. Not yet
built — this documents the design so it can be picked up later without
re-deriving it. Constraints fixed going in:

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
- **All world mutation already flows through one queue** — UI never touches
  the ECS world directly; it pushes `Command`s (`types/commands.ts`) that
  `commandsSystem.ts` drains and applies once per tick. That queue is exactly
  the seam a network layer needs to intercept.

The one non-deterministic piece is `createGameContext` seeding its RNG from
`Date.now()` (`client/src/engine/game/context.ts`) — see [Determinism
prerequisites](#determinism-prerequisites).

## The core trick: both clients play as `Owner.Player`

The engine has exactly two non-neutral sides baked in everywhere — base
placement, fog of war (`fogSystem` is explicitly _player-only_), camera
follow, HUD labels, starter counts. Rather than teach all of that about a
third `Owner.Player2`, **each client simulates itself as `Owner.Player` and
the opponent as `Owner.AI`**, symmetrically. Concretely: when relaying a
command the _peer_ issued locally as their own `Owner.Player`, the receiving
client re-tags it to `Owner.AI` before enqueueing it into its own engine. Both
ends do this same relabeling, so both ends run the identical simulation
under the identical seed, each just looking at it from their own side.

This is the single biggest simplification in this plan — it means the
following need **zero changes**:

- `gameConfig.bases.placements`, `spawnStarters` — corners stay fixed.
- `fogSystem` / fog-of-war rendering — already player-only, already correct
  per-client.
- HUD, camera-follows-your-drone, selection/build UI — already assume "you
  are Player".

What genuinely needs a change: `aiSystem(ctx, dt)` (the bot) must **not**
run in a networked match — `Owner.AI` is a real opponent now. Gate that one
call in `GameScene.update()` behind a new flag (e.g. `ctx.online: boolean`,
set from `GameSettings.match`).

**Known limitation, accepted for now:** because both clients simulate the
_entire_ world (including the fog-hidden opponent), a client could in
principle inspect it via devtools — the same class of issue classic lockstep
RTS games (StarCraft, Age of Empires) have always had. Fixing that requires
server-authoritative simulation, which is explicitly the heavier alternative
this plan opts out of. Not addressed here.

## Wire protocol

Kept intentionally thin — the Durable Object should not need to understand
game rules at all, just pair two sockets and relay bytes. Define the message
shapes once in a shared **`@drone-directive/protocol`** workspace (types-only) importable by both the
client and the Worker (Workers support TypeScript, so no duplication):

| Direction                      | Message                                               | Purpose                                                                                                                     |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Client → Worker                | `{ type: 'create' }`                                  | Host opens a room, gets a room code back.                                                                                   |
| Client → Worker                | `{ type: 'join', roomCode }`                          | Guest joins an existing room.                                                                                               |
| Worker → both                  | `{ type: 'start', seed: number, mapSize: MapSize }`   | Sent once the room has exactly 2 sockets — shared RNG seed + match settings. Fires `GameEngine.startMatch`.                 |
| Client → Worker → other client | `{ type: 'tick', tick: number, commands: Command[] }` | Sent every local sim tick (see [Lockstep tick loop](#lockstep-tick-loop)); the DO just rebroadcasts it to the other socket. |
| Worker → remaining client      | `{ type: 'opponentLeft' }`                            | On disconnect — the match ends (no reconnection support, see [Out of scope](#explicitly-out-of-scope)).                     |

The Durable Object's entire job: hold up to 2 WebSocket connections per room,
generate the seed once the second one connects, and forward every `tick`
message it receives to the _other_ socket in the room. No game logic, no
persistence beyond the room's lifetime.

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
2. A new `LockstepSession` (proposed: `client/src/pixi/net/LockstepSession.ts`,
   sibling to `client/src/pixi/audio/`) buffers both the local and the peer's
   incoming `tick` messages by tick number.
3. Before `GameApp.step()` calls `engine.tick(dt)`, it asks the session: do I
   have _both_ sides' commands for `currentTick` yet? If not, skip ticking
   this frame (stall) — both clients stall the same way when the network
   lags, which is the standard, simple lockstep behavior. If yes, enqueue
   both sides' commands (peer's re-tagged to `Owner.AI` per the trick above)
   into `engine`, tick, advance `currentTick`.
4. `GameLoop.ts` itself needs **no changes** — it just keeps calling
   `update(dt)`; `GameApp.step()` deciding to no-op on a stalled tick is
   invisible to it. Minor known rough edge: `GameLoop`'s accumulator still
   counts a stalled call as "consumed", so its render-interpolation `alpha`
   isn't perfectly meaningful during a stall. Cosmetic only, not a
   correctness issue — not worth fixing for v1.

## Determinism prerequisites

- `createGameContext` (`client/src/engine/game/context.ts`) must take the seed as a
  parameter instead of deriving it from `Date.now()` — the `start` message's
  `seed` becomes `GameEngine.startMatch`'s source of truth for online
  matches (keep the `Date.now()` fallback for solo/offline play).
- Keep the existing invariant: no `Math.random()` / `Date.now()` /
  `performance.now()` anywhere under `client/src/engine/**`. This already holds
  today; it just needs to stay true as the engine grows.
- **Recommended, not required for a first cut:** a cheap per-N-ticks state
  checksum (e.g. hash of every entity's rounded position + hp) included in
  the `tick` message. If a client ever receives a mismatched checksum for a
  tick it already simulated, that's an unambiguous desync — surface it as an
  error and end the match, rather than let two clients silently play
  different games. A few lines of code, high debugging value; can land after
  the core loop works.

## Explicitly out of scope

- **Pause** — per the stated requirement, not synchronized; the in-match
  pause hotkey/button should simply be disabled while online
  (`usePauseHotkey.ts` gated behind `!online`).
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
| `client/src/pixi/net/LockstepSession.ts` (new) | WebSocket connection, per-tick command buffering/stall logic, owner relabeling.                                                                                                                                                                         |
| `client/src/pixi/GameApp.ts`                   | `step()` consults `LockstepSession` (when online) before calling `engine.tick()`.                                                                                                                                                                       |
| `client/src/engine/game/scenes/gameScene.ts`   | Gate the `aiSystem(ctx, dt)` call behind `ctx.online`.                                                                                                                                                                                                  |
| `client/src/engine/game/engine.ts`             | `startMatch` accepts an optional external seed.                                                                                                                                                                                                         |
| `client/src/engine/game/context.ts`            | `createGameContext` takes the seed as a parameter instead of calling `Date.now()` internally.                                                                                                                                                           |
| `client/src/config/gameSettings.ts`            | Add an online/match-mode flag to `MatchSettings`. For online matches, force symmetric starter counts (reuse `gameConfig.difficulty.normal` for both sides) rather than exposing the asymmetric Easy/Hard presets — those only make sense against a bot. |
| `client/src/store/gameStore.ts`                | Connection/lobby status state (`connecting` / `waitingForOpponent` / `inMatch` / `opponentLeft`).                                                                                                                                                       |
| `client/src/ui/screens/OnlineLobby.tsx` (new)  | Create/join-room screen, wired from `MainMenu.tsx`.                                                                                                                                                                                                     |
| `client/src/ui/hooks/usePauseHotkey.ts`        | Disabled while `online`.                                                                                                                                                                                                                                |

## Suggested phases

1. **Core loop, no UI polish.** Worker + Durable Object relay, seed handoff,
   `LockstepSession`, owner relabeling, `aiSystem` gating. Verify by running
   two browser tabs against the same local Worker (`wrangler dev`) and
   confirming both simulate identically.
2. **Lobby UI.** Create/join screen, room codes, connecting/waiting states,
   disconnect handling.
3. **Desync detection.** Per-tick checksum + error surfacing.
4. **Polish.** "AI" HUD labels reading "Opponent" in online matches, latency
   indicator, `INPUT_DELAY_TICKS` tuning.

Before committing to Durable Objects, double-check Cloudflare's current
Workers/Durable Objects free-tier limits (WebSocket connection duration,
request counts) against this game's needs — pricing/limits pages change over
time and this plan doesn't re-verify them.
