# Local avoidance — units jam against terrain, one at a time

> Status: **CLOSED by measurement — and the diagnosis below is wrong on its
> central point.** Anti-jam retreats went from ~70/minute to **0** in a measured
> headless match, with 0.01 robots genuinely stalled on average.
> Execution plan and the correction: `.docs/tasks/local-avoidance.md`.
>
> Step 1 (smooth the individual path) shipped and helped. Steps 2 and 3 rest on
> "units jam against static geometry", and a direct measurement of what each
> retreat was up against says otherwise: 1–2% of retreats happen with the hull
> against rock, while 66–96% happen with another robot inside contact distance,
> the average neighbour being exactly 22 px away. **They jam against each other:**
> `movementSystem` drives a robot its full step into a neighbour and
> `separationSystem` puts it back exactly, every tick, until the anti-jam retreat
> fires. Title of this file is right; the "against terrain" in it is not.
> The reasoning that concluded otherwise is preserved below, including the step
> that broke it — `meanMinGapPx` describes the field, not the robot that stalled.
>
> This is what `.docs/rejected-by-metrics/flow-field-navigation.md` was really
> aiming at. That investigation ruled out the navigation layer as the cause and
> left this: the defect is in how a *single* unit deals with what is in front of
> it.

## The baseline

Two matches, 30 Hz, grid 60×60, measured with a temporary probe (see the
rejected doc for how). One match drove groups with formation orders, the other
moved every unit individually.

| | Group play | Solo play |
|---|---|---|
| Robots in formation | 3.41 | **0** |
| Anti-jam retreats / minute | **69.98** | **73.27** |
| Robot-ticks spent retreating | 2520 / 4321 | 2415 / 3955 |
| Share of ticks with ≥1 stalled robot | **0.43** | 0.39 |
| Stalled robots (avg / peak) | 0.69 / 6 | 0.71 / 7 |
| Mean closest pair (px) | 35.1 | 37.5 |
| Overlapping pairs / tick | 1.0 | 0.61 |
| Contact distance (px) | 22 | 22 |

"Stalled" = has a goal and made less than `stuckEpsilon` (0.5 px) of net progress
over a full tick — the same test `maybeStartRetreat` uses, sampled before the
move loop so it measures a whole tick.

**Every fix below is measured against this table.** The probe is disposable but
the metrics are not: re-instrument, replay both match types, compare.

## What the numbers say

**The retreat crutch fires more than once a second.** `maybeStartRetreat` was
built as a last-resort unjammer. At 70/minute it is not a safety net, it is part
of normal locomotion — and it drives units *backwards*, away from where they were
sent, for `retreatSeconds` (0.5 s) at full speed.

**It is not a crowding problem.** Mean closest pair is 35 px against a 22 px
contact distance, and about one overlapping pair per tick across the whole field.
Units are not packed. Yet 40% of ticks contain a stall.

**It is not a group problem.** The solo match had zero formations and zero shared
routes, and came out marginally *worse* on every congestion metric. Whatever this
is, it happens to one unit at a time.

**So units are jamming against static geometry** — terrain edges and base
footprints (`navObstacles` includes living base footprints, see `navGrid.ts`) —
not against each other.

## Why it happens

Three things compound, and none of them is the pathfinder being wrong:

1. **No local avoidance exists at all.** `systems/separation.ts` is explicitly
   *corrective*: it runs after movement and pushes apart anything already closer
   than `radius * 2`. Nothing anywhere looks ahead. A robot drives into an
   obstacle corner at full speed and only then discovers it.
2. **The path is a staircase through tile centres.** `findPath` walks tile
   centres, so a diagonal is a zigzag that swings half a tile either side of the
   line the unit actually wants. `smoothRoute` exists in `formation.ts` and fixes
   this *for the frame only* — the comment there records 5060 hold/drive flips
   against 280 once smoothed. Individual robots get no such treatment.
3. **The retreat masks the symptom and creates a new one.** Backing out for 0.5 s
   clears some jams, but it also means a stalled unit spends half a second
   travelling the wrong way, then re-approaches into the same geometry. At 70/min
   a meaningful share of all movement is this loop.

The corridor of the pipeline (`gameScene.ts`) is
`taskSystem → movementSystem → separationSystem` — decide, move, then repair
overlaps. There is no step between "decide" and "move" where a unit could adjust
its own step for what it is about to hit.

## Direction

Ordered by expected return against the baseline, cheapest first. Each is
independently shippable — this is not one big rewrite.

### 1. Smooth the individual path (cheapest, do first)

Give `setGoal` the same line-of-sight pass the frame already gets: drop a
waypoint whenever the hull can drive straight from the last kept point to the one
after. `smoothRoute` + `hasClearance` in `formation.ts` are already written and
already handle hull width — the work is extracting them somewhere both callers
can reach (`pathfinding.ts` or a sibling) rather than writing anything new.

Costs essentially nothing: pathfinding is 4 nodes per search and 6% of it is
frame routes.

**Expect:** fewer stalls at diagonal terrain edges, lower `stalledTickShare`.
Will not fix head-on approaches into a corner.

### 2. Look ahead one step before moving

A preventive check between decide and move: before committing this tick's step,
test whether the destination puts the hull inside a blocked tile, and if so slide
along the obstacle face instead of pressing into it. This is the missing half of
`separation.ts` — the same idea, but against terrain and applied *before* the
move rather than after.

Keep it strictly local and cheap; this is not RVO/ORCA. A hull-radius probe
against `navObstacles` at the proposed position, plus a tangential slide, is
enough to test the hypothesis that terrain contact drives the retreat count.

**Expect:** the large one. If retreats/minute do not fall substantially here, the
diagnosis above is wrong and this document needs revisiting before going further.

### 3. Retire the anti-jam retreat

Once 1 and 2 land, `maybeStartRetreat` should be firing rarely enough to reduce
to what it was meant to be — an escape hatch for a genuinely trapped unit, mainly
the "shoved inside a base footprint" case `findPath` already special-cases.
Raising `stuckAfter` and shrinking `retreatSeconds` is the first move; deleting
the backwards drive in favour of a sideways step is the second.

Do **not** touch this before 1 and 2 are measured — right now it is load-bearing,
however badly.

### 4. Only if a crowd problem shows up later

Nothing in the baseline justifies velocity-space avoidance (RVO/ORCA) at these
unit counts — mean closest pair is 35 px and there are ~7 moving robots. If unit
counts grow by an order of magnitude, re-measure `overlapPairsPerTick` and
`meanMinGapPx` first; those are the metrics that would justify it.

## Constraints that bound every option here

- **Lockstep determinism.** The simulation runs fixed-step at 30 Hz with a seeded
  RNG and both peers must agree exactly. No wall-clock, no frame-rate-dependent
  amortisation, no `Math.random` — `separation.ts`'s `coincidentAngle` shows the
  house pattern for "needs a pseudo-random direction, must stay deterministic".
  This is also what rules out a WASM crowd library.
- **Anything that positions a robot must agree with separation and anti-jam.**
  The standing rule from `.docs/issues/formation-jitter-and-narrow-passes.md`:
  any "he's arrived" tolerance must be strictly less than half the gap between
  placement spacing and `radius * 2`, or two systems pull the same unit forever.
  A preventive avoidance step is exactly such a positioner.
- **No mechanism may hand several units the same point.** Same source. It will be
  handed out at the worst possible moment — in the throat of a pass.
- **Engine layer rules.** `client/src/engine/**` — no Pixi, no React, no store,
  and `@typescript-eslint/no-non-null-assertion` is enforced.

## How to verify

Unit tests will not show this; neither will watching the screen, since a stall
looks the same whatever causes it. The method that worked for the formation bugs
is a throwaway headless run (`__scratch.test.ts`, deleted afterwards): a squad, N
ticks of the real `taskSystem → movementSystem → separationSystem` pipeline, and
a dump of what cannot be seen — stalls, retreat starts, min gap, hold/drive
flips.

For on-screen confirmation the probe from the rejected doc is the right shape:
counters plus a `window.__probe()` in dev builds, two match types, compare
against the baseline table above.

Whatever lands should leave a permanent test behind, the way `formation.test.ts`
holds the slot-spacing invariant — a regression that costs 70 retreats/minute
should break the build, not the game.

## See also

- `.docs/rejected-by-metrics/flow-field-navigation.md` — why the navigation layer
  was ruled out, and the full measurement.
- `.docs/issues/formation-jitter-and-narrow-passes.md` — the four local-layer
  root causes fixed in `9e47bbc`, and the rule about positioners.
- `.docs/issues/formation-deadlock-at-a-hairpin.md` — a squad frozen for the rest
  of the match at a doubling-back route, surfaced while measuring this work.
  Older than these stages, but stage 1–3 are what made it reproducible: with the
  retreat retired, `box` stopped tripping it and every other shape kept doing so.
- `.docs/movement.md` — pathfinding + movement as they stand.
- `.docs/tasks/movement-refactor.md` — the previous pass over these files.
