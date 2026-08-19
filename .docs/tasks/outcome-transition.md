# The outcome transition — how a match ends on screen

## The problem it was built for

Winning or losing used to happen in one frame. `reapSystem` removes the dead base
and spawns its explosion, and `GameScene.checkGameOver()` runs at the end of **the
same tick**, so `gameOver` / `sideEliminated` reached the store synchronously and
React painted the game-over modal on the next paint. The base blew up and less
than a second later the player was looking at a still picture and listening to a
different track. There was no beat anywhere in it.

Two things underneath made it worse, and both are fixed here rather than papered
over:

- **The death blast was never played.** `GameScene.update` bailed on its first
  line once `over` was set, and `explosionSystem` is inside that early return. Every
  live explosion stopped ageing on the tick after `gameOver` — the base's own froze
  at `age ≈ 0.033` of its life (alpha 0.93, radius ~6 px) and sat there under the
  modal until the player left.
- **A base died like a robot.** `reapSystem` called `spawnExplosion(world, pos)`
  with no size, so the end of the match was the same 30 px puff a single unit
  leaves.

## The three beats

The grammar is the one every RTS of the era used — Dune II, Warcraft II, C&C all
do the same thing: hold on the killing blow, fade the world out, then show the
card. Audio leads the picture: the music turns over at the blast, not at the card.

| Phase | Length | What is on screen |
| --- | --- | --- |
| `hold` | 1400 ms | The live field and the HUD, unchanged. The base's blast — now 110 px over 1.6 s — burns down. The match bed cross-fades out and the outcome stinger starts, both at t=0. |
| `veil` | 900 ms | `.outcome-veil` fades the whole viewport, HUD included, to `--bg`. It never fades back out. |
| `reveal` | 600 ms + 350 ms | The outcome art fades up out of the black (`.dialog-backdrop--outcome`), then the card lifts in behind a 250 ms delay (`.modal--outcome`). Both are CSS; no timer drives them. |

Buttons are reachable at about 3 s.

## Where each piece lives

| Piece | File |
| --- | --- |
| The phase itself | `OutcomePhase` in `client/src/store/enums.ts`, `outcomePhase` in the store |
| The sequencer | `GameApp.beginOutcome` / `clearOutcome`, `OUTCOME_HOLD_MS` / `OUTCOME_VEIL_MS` |
| The veil | `.outcome-veil` in `App.css`, rendered by `App.tsx` |
| The card's gate | `GameOverModal` returns `null` until the phase is `reveal` |
| Effects after the end | the `over` branch of `GameScene.update` |
| The base's blast | `fx.baseExplosion*` in `gameConfig.ts`, used by `reapSystem` |

## Why the delay is presentational, not a deferred `gameOver`

The obvious implementation — hold the `gameOver` emit back for N ticks inside the
scene — was **not** taken. The engine still decides and announces the outcome on
the tick the last base falls; only the *reveal* is deferred, by wall-clock timers
in `GameApp`.

- **Lockstep.** A match is simulated in step on both peers. Putting a delay inside
  the deterministic pipeline means both peers must agree on it, and it buys
  nothing: they have already agreed on the outcome, and neither is waiting for the
  other's rendering.
- **`status` stays the engine's truth.** `GameStatus.Won` / `Lost` is set the
  instant the outcome is known — the online session, the store and anything else
  reading it are unaffected by how long the picture takes. `outcomePhase` is a
  second, purely visual axis, which is why it is a separate field rather than two
  more `GameStatus` members.

The cost of that split is the one rule to remember: **anything that ends a match
must reset the phase.** `sceneChanged` does it on both branches (Play Again and
Main menu) and `destroy()` does it on teardown, so a pending timer can never land
in the next match.

## Things worth knowing before changing it

- **`beginOutcome` is idempotent by design.** A free-for-all knock-out raises the
  defeat twice — `sideEliminated`, then `gameOver` on the tick the last side is
  left — and the guard on `outcomePhase !== 'none'` is what makes the reveal run
  once. The same guard is what `music.playOnce` does for the stinger.
- **Reduced motion skips the wait, not just the fades.** `beginOutcome` jumps
  straight to `reveal` when `prefers-reduced-motion` is set; the `@media` block in
  `App.css` only covers the three animations, which no media query could have
  cancelled the 2.3 s of timers.
- **The field stops taking clicks for the whole transition** (`.viewport--settling`).
  Without it a player can still drag a selection box and set off cues under a veil
  that is fading them out.
- **`hold` and `fx.baseExplosionDuration` belong together.** 1400 ms is chosen so
  the 1.6 s blast is most of the way through when the veil starts. Change one and
  look at the other.
- **Chat sits above all of it** (`z-index: 40` against the veil's 9). That is
  deliberate and predates this — chat outlives the match on purpose.
