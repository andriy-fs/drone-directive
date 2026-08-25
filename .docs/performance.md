# Performance

The simulation is a fixed 30 Hz step; the scene is redrawn on the browser's own
frame, so the render budget is 16.7 ms for 60 fps. This document covers the
in-game instrumentation used to keep it there.

## The on-screen readout

Add `?perf=1` to the URL for an on-screen frame-time readout: fps and mean frame
time, plus the **p95** and the worst frame since the run started. Read the p95 —
panning that hitches every few frames can hold a respectable average while
feeling broken, and the average is exactly the statistic that hides it.

It also prints the conditions a reading was taken in (map size, robot count,
whether the match is paused, `devicePixelRatio`), because a number without them
is not comparable to the next one. The first 90 frames after a match starts are
discarded, so texture uploads and the first build of the static geometry don't
land in the numbers.

## Bisecting a slow frame

Render layers can be switched off individually alongside the readout, which is
how you find out _what_ is slow instead of guessing:

```
?perf=1&terrain=0     whole terrain view off      &shadow=0   cast shadows off
       &galt=0        second ground variant off   &depth=0    depth shading off
       &gdec=0        ground decals off           &rim=0      cluster rim off
       &fog=0         fog redraw off              &peaks=0    ridge decals off
       &aa=0          antialias off
```

Turn one off, pan the observer drone for ten seconds, compare the p95. Whatever
moves the number is the answer.

Two habits are worth keeping from the worked examples:

- **Measure the same conditions on both sides of a change.** Same map size,
  matched robot count, match running, warm-up gone. A comparison between two
  differently-loaded runs is not a comparison.
- **Expect the intuitive cause to be wrong.** In the terrain investigation, fog
  redraw (the suspect) was inside the noise, while a single `Sprite` used as a
  mask — which Pixi 8 implements as a full offscreen filter pass at device
  resolution with MSAA — cost more than the entire terrain view it was
  decorating.

## Player-facing setting

For a persistent setting rather than a one-off measurement, the title screen's
**Graphics** button trades resolution and antialiasing for frame rate.

## Simulation-side measurement

Rendering is not the only thing that can be measured; the engine is pure and
runs headless, so simulation costs are measured in tests rather than in the
browser. `client/src/engine/systems/orca/__perf.test.ts` asserts the avoidance
solver allocates nothing per tick, and the `__ab` harness runs full matches
across seeds to compare movement layers on arrivals, overlap, and jam counts.
That is also how the flow-field alternative to per-unit A\* was rejected: the
pathfinder turned out to cost ~143 cells/second, a number no redesign could
usefully improve.
