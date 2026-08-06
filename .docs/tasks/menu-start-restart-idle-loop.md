# Menu Start restart regression: root cause and fix

## Problem summary

After adding the title-screen splash backdrop, the Start button could appear clickable and still not begin a match reliably. Console tracing showed that the whole click chain from the menu button to the store flag fired correctly:

- `MainMenu.start click`
- `gameStore.requestRestart`
- `GameApp.store flag changed`

However, the next step in the actual game-loop path never reached the restart branch:

- `GameApp.step restart/menu branch`

That pointed to a control-flow issue in the Pixi bridge rather than a broken `onClick` binding.

## Root cause

The game loop's render pass used a very aggressive idle-parking rule:

- while the engine context was `null` (`menu` scene)
- and the loop was effectively idle,
- the app would call `sleep()` on the next render frame.

When the user clicked Start, the restart request was set in the store and the `GameApp` loop woke up, but the very next render frame immediately observed the menu state and parked the ticker again before the next fixed-step simulation frame could process the pending request.

In practice the sequence was:

1. button click fires `requestRestart()`
2. `GameApp` `wake()` is called by the store subscription
3. the first render frame arrives while the engine is still in `menu`
4. the idle rule stops the ticker right away
5. the pending `restartRequested` flag sits unprocessed, so the match never starts

This became visible only after the menu-splash flow changed the startup timing, because the menu scene no longer had a live world that kept the loop busy.

## Fix applied

The fix was to make the idle shutdown logic aware of pending user requests:

- if `restartRequested` or `menuRequested` is currently set,
- the loop must stay awake for at least one more fixed-step cycle,
- so the engine can consume that one-shot flag and transition from `menu` to a live match.

The updated guard in `GameApp.render()` now avoids calling `sleep()` while a restart/menu request is pending, which allows the next `step()` to process the request instead of being skipped by an immediate park.

## Why this is the correct fix

The issue was not that the Start button failed to fire. The issue was that the app-layer request was being raised correctly, but the loop lifecycle was parking too early for a restart request to be consumed.

This fix keeps the intended contract:

- UI raises a one-shot restart request in Zustand
- `GameApp` observes that request
- the fixed-step loop consumes it on the next tick
- the engine transitions into `GameScene` and the match starts

## Lessons for future hardening

This regression is a good example of a lifecycle race between:

- one-shot store controls (`restartRequested`, `menuRequested`)
- reactive subscription callbacks (`subscribe` in `GameApp`)
- fixed-step tick scheduling (`GameLoop` + Pixi ticker)

To prevent similar regressions in the future, the following areas are worth hardening:

1. Add a focused integration test around the restart request path:
   - menu button → store flag → `GameApp.step()` → `engine.startMatch()`
2. Add a regression test for the “idle menu + pending restart flag” state, so the loop cannot immediately sleep before consuming the request.
3. Consider making the restart contract more explicit in the bridge layer:
   - one-shot request consumption should be coupled to a visible “wake + consume once” behavior
   - not implicitly depend on the render frame order
4. Review similar `sleep()`/`wake()` transitions for any other one-shot UI requests that may race with the menu scene.

## Hardening applied

The first fix guarded the park with an explicit flag check (`!restartRequested && !menuRequested`), which left the same race open for the third one-shot control, `pendingOnline` — hosting or joining from the title screen woke the loop and parked it again before `step()` could consume the request.

The guard is now a loop invariant instead of a list of flags. `GameLoop` tracks whether a fixed step has run since it last resumed, and `park()` refuses (returning `false`) until one has:

- `GameLoop.resume()` / `GameLoop.park()` own the ticker start/stop and the guard;
- `GameApp.render()` is back to the plain rule — `if (this.idle) this.sleep()` — and `sleep()` only flushes the final frame when `park()` actually parked;
- any future one-shot request is covered without touching the render path, because the loop guarantees **at least one `update()` per wake-up**.

Why the very first frame after a wake runs no step: `Ticker.start()` resets `lastTime` to `performance.now()`, so that frame reports ~16 ms against the 33.3 ms fixed step, and `GameLoop`'s accumulator (empty, because the loop parks right after a step drains it) never reaches the threshold.

Regression coverage lives in `client/src/pixi/GameLoop.test.ts` (fake ticker, no Pixi/DOM):

- a frame shorter than the fixed step renders without stepping — the hazard itself;
- `park()` refuses on the first frame after `resume()` and succeeds once a step has run;
- a one-shot request raised while parked is consumed after the wake-up rather than swallowed;
- `park()`/`resume()` are idempotent and a stopped loop cannot be resumed.

Both regression tests fail if the guard is removed.

## It came back, from the other side (asset gate)

`GameLoop`'s "at least one `update()` per wake-up" guarantee assumes that one
`update()` is enough to *consume* the request. The sprite-loading gate (see
`asset-loading-first-paint.md`, step 3) broke that assumption: while the textures
are still in flight, `step()` deliberately returns without consuming
`restartRequested`, so the wake-up's one guaranteed step is spent holding it.

Sequence, with a 60 Hz display against the 30 Hz sim:

1. Start → `restartRequested` flips → `wake()` → the loop resumes.
2. Frame N steps; the gate holds the request and kicks the full-priority load.
3. A microtask later the sprites resolve — they had already been warmed in the
   background, so this is immediate — and the hold is released.
4. Frame N+1 renders **without** stepping (every other frame does, at 60 Hz), and
   `park()` now agrees because a step *did* run in frame N. The loop parks on a
   request that was never consumed.
5. Nothing revives it. `wake()` fires on a flag **changing**, and `requestRestart`
   writes `true` over `true`, so pressing Start again is a no-op. Dead until reload.

Intermittent on a cold load (it depends on whether the sprites land in the gap
between two steps), but **100% reproducible after opening any menu modal** — the
time spent in the modal is more than enough for the background loader to finish,
which puts step 3 exactly in that gap every time.

The fix is in `GameApp.idle`, which no longer keys off "waiting for sprites" but
off "nothing outstanding":

```ts
private get idle(): boolean {
  if (this.engine.context !== null || this.pendingOnlineStart !== null) return false;
  const { restartRequested, menuRequested } = useGameStore.getState();
  return !restartRequested && !menuRequested;
}
```

The lesson generalizes past this one gate: **the loop may only park when there is
nothing left for a step to consume** — not merely when a step has happened. Any
future early `return` in `step()` is safe only if `idle` accounts for whatever it
declined to consume.
