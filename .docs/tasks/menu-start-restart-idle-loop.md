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
