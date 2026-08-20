# Local avoidance — implementation plan

> **Stage 1 shipped and accepted; stage 2 is suspended — the diagnosis it rests
> on has been falsified.** See "What the measurement actually found" below before
> reading anything past stage 1. Written 2026-08-20 as the execution plan for
> `.docs/todo/local-avoidance.md`, which holds the diagnosis and the measured
> baseline. This document holds the work: what to change, in what order, and what
> each stage has to prove before the next one starts.
>
> This is Stage B of `.docs/tasks/movement-refactor.md`, re-scoped by the
> measurement that closed `.docs/rejected-by-metrics/flow-field-navigation.md`.
> Stage A (the formation frame marching along its A* route) shipped in `9e47bbc`
> / `2014b94`; the files here barely overlap with it.

## Context

After `9e47bbc` the formation layer is sound, but the *unit* layer is not. Two
instrumented matches (30 Hz, grid 60×60) produced this baseline:

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

The retreat crutch fires more than once a second; 40% of ticks contain a robot
that wants to move and cannot; and robots are **not** packed (35 px mean closest
pair against a 22 px contact distance). The solo match had no formations and no
shared routes and came out marginally worse. So the jam is one unit at a time
against **static geometry** — terrain and living base footprints, both of which
sit in `ctx.navObstacles` (see `engine/navGrid.ts`).

Three things compound:

1. **Nothing looks ahead.** `systems/separation.ts` is explicitly corrective and
   runs *after* movement, and it only knows about other robots. A robot drives
   into a rock face at full speed and discovers it on arrival.
2. **Every unit drives a tile-centre staircase.** `findPath` walks tile centres,
   so a diagonal zigzags half a tile either side of the line the unit wants.
   `smoothRoute` fixes this **for the frame only** — its own comment records 5060
   hold/drive flips against 280 once smoothed.
3. **The retreat masks it and adds its own damage.** Half a second at full speed
   in the wrong direction, then a re-approach into the same geometry.

The pipeline in `game/scenes/gameScene.ts` is
`taskSystem → movementSystem → separationSystem` — decide, move, repair. There is
no step between *decide* and *move*. Stage 2 is that step.

Three details the todo states slightly wrong, corrected here against the code:

- `hasClearance` is **not** in `formation.ts` — it already lives in
  `obstacles.ts`, exported and covered by `obstacles.test.ts`. Only `smoothRoute`
  needs extracting.
- `smoothRoute` **prepends a head point**, which the frame needs and `setGoal`
  must not get. The extraction splits that responsibility rather than copying it.
- The measurement probe from the flow-field investigation is still in the working
  tree, uncommitted. It is the before/after harness, not litter.

## Constraints (they bound every stage)

- **Lockstep determinism.** Fixed 30 Hz, seeded RNG, both peers must agree
  exactly. No `Math.random`, no wall-clock, no frame-rate-dependent amortisation.
  Anything needing a pseudo-random direction copies the house pattern:
  `coincidentAngle` in `separation.ts` or `evadeSide` in `task/outcomes.ts` — a
  hash of the entity id. Iteration order comes from miniplex queries (stable)
  with an id tiebreak where a sort is needed.
  `client/src/engine/game/determinism.test.ts` must stay green.
- **Anything that positions a robot must agree with separation and anti-jam.**
  The standing rule from `.docs/issues/formation-jitter-and-narrow-passes.md`: an
  "arrived" tolerance must be strictly less than half the gap between placement
  spacing and `radius * 2`, or two systems pull the same unit forever. The Stage-2
  slide is such a positioner — it is bounded by this tick's step, so it can never
  outrun separation's push, and it changes **no** arrival tolerance.
- **No mechanism may hand several units the same point.** Same source. The slide
  only rotates a unit's own step; it never computes a target another unit could
  also be given.
- **Engine purity.** `client/src/engine/**` imports no Pixi, React, store or net,
  and `@typescript-eslint/no-non-null-assertion` is enforced. `pathfinding.ts`
  today imports only config, types and `obstacles.ts` — keep it that way (pass
  the grid, never `GameContext`).

## Stage 0 — put the measurement harness back to work

The probe from the flow-field investigation is still in the working tree,
uncommitted: `client/src/engine/goalProbe.ts` plus four call sites
(`probeSearch`/`probeExpansion` in `findPath`, `probeRetreat` in
`maybeStartRetreat`, `probeSweep` at the top of `movementSystem`, `probeKindNext`
in `routeFor`) and the `window.__probe()` / `__probeReset()` hooks in
`pixi/GameApp.ts`.

- **Keep it, uncommitted, for the whole task.** It is the only instrument that
  produced the baseline, and every gate below is read off it.
- Re-confirm the baseline **before** touching anything: two matches, one driving
  groups with formation orders, one moving every unit individually, `__probe()`
  after each. If the numbers have drifted from the table above, the table is
  replaced, not the diagnosis.
- Add a throwaway `client/src/engine/systems/__scratch.test.ts` for the headless
  half — a squad, N ticks of the real `taskSystem → movementSystem →
  separationSystem` pipeline, printing what cannot be seen (stalls, retreat
  starts, min gap, hold/drive flips). Deleted afterwards, as in `9e47bbc`.
- Delete the probe and its five call sites in Stage 4.

**Why both.** The scratch test isolates one squad and one piece of terrain and
answers "did this change do what I think"; the probe answers "does a real match
still jam". The flow-field investigation was decided by the second and would have
been decided wrongly by the first.

## Stage 1 — smooth the individual path

**Files:** `client/src/engine/pathfinding.ts`,
`client/src/engine/systems/movement.ts`,
`client/src/engine/systems/task/formation.ts` (loses its private copy),
`client/src/engine/pathfinding.test.ts` (new).

Extract `smoothRoute` from `formation.ts` into `pathfinding.ts` and give `setGoal`
the same pass the frame already gets. `hasClearance` needs no work at all — it is
already exported from `obstacles.ts`, already hull-width aware, and already
covered by `obstacles.test.ts`.

**1.1 — the extracted helper.**

```ts
export function smoothPath(grid: ObstacleGrid, from: Vec2, points: readonly Vec2[], radius: number): Vec2[]
```

Body is today's greedy one-pass loop, moved verbatim, with **the head dropped**:
it returns the kept waypoints only. Take `grid`, not `ctx` — `pathfinding.ts` must
not learn about `GameContext`. Carry the existing doc comment across; the
5060-vs-280 measurement in it is the reason the function exists.

**1.2 — `routeFor` keeps its head.** Its `findPath` call in `formation.ts` becomes
`[{ x: anchor.x, y: anchor.y }, ...smoothPath(ctx.navObstacles, anchor, findPath(...), radius)]`,
with the "the head is load-bearing" comment moved to the call site. This is not
cosmetic: the frame projects the group's anchor onto the polyline and steps
forward along it, and without the head a smoothed straight run collapses to a
single point and dissolves the formation. Empty input must still yield an empty
array (the caller reads that as "no route") — so the head is only prepended when
the smoothed list is non-empty.

**1.3 — `setGoal` smooths, without the head.**

```ts
const raw = findPath(ctx.navObstacles, entity.position, { x, y });
const path = smoothable(ctx, entity.position)
  ? smoothPath(ctx.navObstacles, entity.position, raw, gameConfig.robots.radius)
  : raw;
```

`m.path[0]` is the next `destination`, so a head equal to the robot's own position
would burn a tick arriving at its own feet.

**1.4 — do not smooth out of a blocked start.** `findPath` prefixes an escape hop
when the start tile is blocked (a robot shoved inside a base footprint), and that
hop is the only thing that unfreezes it. `hasClearance` from inside a blocked tile
returns false for every candidate, so smoothing would in practice change nothing —
but relying on that is relying on an accident. Guard explicitly: skip smoothing
when `isBlockedGrid(ctx.navObstacles, tileOf(entity.position))`.

**1.5 — leave `findPath` alone.** Smoothing at the call site, not inside the
search, keeps the escape-hop contract, keeps the four existing `findPath` tests
meaningful, and keeps `pathfinding.ts`'s two callers free to differ (they do — one
wants the head, one must not have it).

**Cost.** Nothing: 4 nodes per unit search, ~1.6 searches/tick, and the smoothing
loop is O(n²) probes over a path of a few points.

**Known risk to watch in the numbers.** A smoothed line hugs the rock it just cut
the corner off, so units now drive *closer* to obstacle faces than the staircase
did. Until Stage 2 lands this could push terrain contact **up**. If it does, the
mitigation is one number — pass `radius * 1.5` as the clearance radius here (not
in `routeFor`, whose frame already has `corridorSpan` measuring the gap it is
entering) — not a redesign.

**Gate.** `stalledTickShare` and retreats/minute both move down, or at worst hold,
on both match types. A rise in either means the wall-hugging risk landed; widen
the clearance and re-measure before starting Stage 2.

## What the measurement actually found

**Stage 1 (path smoothing) is in and accepted.** Measured on screen, A/B inside a
single session with `__clearance(999)` (raw staircase) against `__clearance(1)`
(smoothed), solo play both arms:

| | staircase | smoothed |
|---|---|---|
| retreats / minute | 93.84 | **90.68** |
| stalled tick share | 0.50 | **0.45** |
| overlapping pairs / tick | 0.83 | **0.40** |
| mean closest pair (px) | 39.35 | 39.51 |

Not a regression on any metric, and overlap halves. The earlier "+37% on solo
play" was **variance between matches**, not an effect: four solo matches on
effectively the same code produced 73, 90, 94 and 100 retreats/minute. Nothing
this size can be measured by comparing one match against a table from a previous
session — only a same-session A/B can see it. Group play, separately, improved by
44% (69.98 → 38.94 retreats/minute).

**And the premise of stages 2 and 3 is wrong.** The retreat classifier added for
this (`retreatsInContact`, then `robotShareOfRetreats`) asks what the robot was
actually up against at the moment it gave up:

| | on screen | headless (five clearance arms) |
|---|---|---|
| retreats with the hull against rock | **0.01 – 0.02** | 0.01 – 0.11 |
| retreats with another robot inside contact distance | — | **0.66 – 0.96** |
| mean distance to nearest robot at the retreat | — | **20.7 – 22.9 px** |

Contact distance is 22 px. Robots are not jamming against terrain **one unit at a
time** — they are jamming against **each other**, and the average neighbour at the
moment of the stall is exactly touching.

The baseline read `meanMinGapPx` 35 against a 22 px contact distance as "there is
no crowd". That number is the closest pair *anywhere on the field*, averaged over
ticks: it describes the field, not the robot that stalled. Reading it as a
property of the stalled robot is the same average-before-separating mistake that
made the first version of this probe answer the wrong question — recorded in
`.docs/rejected-by-metrics/flow-field-navigation.md` and now made twice.

**Consequence:** stage 2 as written below (a hull probe against `navObstacles`
plus a tangential slide) would be aimed at 1–2% of the problem. It is suspended,
not deleted — the text stands as the record of what was planned and why it was
dropped. What replaces it has to be about *units yielding to units*: preventive
avoidance between robots, or an unjam ladder whose first rung steps aside for a
neighbour instead of driving backwards. `separationSystem` already computes every
pair every tick, so the information is on hand.

### What it actually is: movement and separation, deadlocked

Found by running a **real match headless** — `GameEngine.startMatch` with both
seats flipped to `Controller.Bot`, the whole `gameScene` pipeline, production and
combat included. The earlier squad harness measured robots shoving each other and
disagreed with every on-screen number; a real match reproduces them closely
(81.6 retreats/minute against 61–100 in the game, contact share 0.00, eight
distinct retreaters, two of them 61% of all retreats). That harness is
deterministic and offline, so the rest of this needed no play sessions at all.

The trace of one stalled robot, tick by tick:

```
t=813 pos=1699.2,1808.1 movedByMovement=4.50 pushedBack=4.50 nearest=22 dest=1680,1808 speed=135
t=814 pos=1699.2,1808.1 movedByMovement=4.50 pushedBack=4.50 nearest=22 dest=1680,1808 speed=135
...
```

`movementSystem` drives the robot its full 4.5 px step toward a valid waypoint,
and `separationSystem` puts it back **exactly** where it started, every tick, for
as long as the pair holds. Net progress zero, `stuckTime` climbs, the anti-jam
retreat fires — and 0.9 s later the pair does it again. This is the standing rule
from `.docs/issues/formation-jitter-and-narrow-passes.md` failing at the level
below formations: *two systems pulling the same unit forever*.

The nearest-neighbour distance at each retreat, bucketed:

| nearest robot at the retreat | retreats |
|---|---|
| touching (22–30 px) | **167** |
| 30–50 px | 90 |
| overlapping (< 22 px) | 42 |
| 50–100 px | 72 |
| 100+ px | 72 |

47% of retreats have a robot within 30 px, 67% within 50 px. **Every** sustained
stall (six ticks or more) has one within 40 px — a filtered trace for a stall with
nobody nearby comes back empty.

And this is why the binary classifier said the opposite. Its threshold sat at
`radius * 2 + 2` = 24 px, in the middle of the most populated bucket: separation
resolves an overlap to *exactly* 22 px, so a deadlocked pair is almost never
caught overlapping and almost always sits just outside the cutoff. The mean
(50 px headless, 88 px in the game) is dragged up by the long tail on top of that.
**A mean and a threshold have now each hidden this defect once** — the baseline's
`meanMinGapPx`, then `robotShareOfRetreats`. Bucket the distribution; do not
average it, and do not reduce it to a flag.

Two smaller findings from the same run, worth keeping:

- **A goal with no route to it never re-paths.** `setGoal` caches by goal tile and
  returns early on a goal it already holds, so a robot whose `findPath` came back
  empty keeps `m.goal` with no `m.destination` and retreats forever. Rare — 14
  robot-ticks in 9767, no measurable share of retreats — but it is a permanent
  freeze when it happens, and the fix is to make the cache check require a
  destination, not just a goal tile.
- **Dodging is not involved.** 29 stalls of 3962 were under fire; the theory that
  `evadeOutcome`'s per-tick strafe goal starves net progress is wrong.

### What stage 2 should be instead

Local avoidance **between units**, which is what the title of this task said all
along and what the terrain reading talked us out of. Concretely, in the order the
evidence supports:

1. **Movement must not drive into ground a neighbour already holds.** The same
   preventive step the suspended stage 2 describes, with `navObstacles` swapped
   for the robot positions `separationSystem` already visits every tick — the
   pairs are computed there and thrown away.
2. **The anti-jam ladder yields sideways before it reverses.** Stage 3's rung 2,
   promoted: a robot deadlocked against a neighbour needs to step *around* it, and
   driving backwards for half a second is the one response that guarantees the
   next approach repeats the same collision.
3. **Only then reconsider the retreat's tuning.** It stops being load-bearing once
   1 and 2 land, not before.

### Confirmed on screen

The histogram from a real solo match, against the headless one:

| nearest robot at the retreat | real match | headless |
|---|---|---|
| touching (22–30 px) | **61** (42%) | **167** (38%) |
| 30–50 px | 41 | 90 |
| overlapping (< 22 px) | 8 | 42 |
| 50–100 px | 19 | 72 |
| 100+ px | 15 | 72 |
| **within 30 px** | **48%** | 47% |

`undoneShareOfRetreats` 0.47 against 0.47, `noStepShareOfRetreats` 0.53 against
0.53, `stalledTickShare` 0.33 against 0.33, `avgStalledRobots` 0.62 against 0.62.
The headless match is a faithful reproduction, and the diagnosis holds in the
game.

Still owed: the same bucket histogram from a real match. The split is confirmed on
screen only through its rock half (contact share 0.00 in two matches); the
neighbour half is confirmed in the faithful headless match, which reproduces every
other number the game reports.

## Stage 2 — look ahead one step, and slide instead of pressing (SUSPENDED)

> Kept as written for the record. The measurement above says terrain contact
> causes 1–2% of retreats, so this would buy almost nothing. Do not build it.

**Files:** `client/src/engine/systems/avoidance.ts` (new),
`client/src/engine/obstacles.ts` (one new primitive),
`client/src/engine/systems/movement.ts`,
`client/src/engine/systems/avoidance.test.ts` (new).

This is the missing step between *decide* and *move*, and the todo's big bet: if
retreats/minute do not fall substantially here, the diagnosis is wrong and the
todo needs revisiting before any further work.

**2.1 — the primitive.** In `obstacles.ts`, next to `hasClearance` and sharing its
sampling convention:

```ts
/** True if a body of `radius` centred at `p` overlaps any blocked tile. */
export function hullBlocked(grid: ObstacleGrid, p: Vec2, radius: number): boolean
```

Centre plus four axis-aligned probes at ±radius (the same three-probe logic
`hasClearance` uses per sample, closed into a point test). Out of bounds counts as
blocked, as everywhere else — `isBlockedGrid` already does that.

**2.2 — the avoidance step.** A pure function, no ECS knowledge beyond what it is
handed:

```ts
export function avoidStep(grid: ObstacleGrid, pos: Vec2, heading: number, step: number, radius: number): number | undefined
```

Returns the heading to actually drive this tick, or `undefined` for "the straight
step is fine". Contract:

- If `!hullBlocked(grid, pos + dir(heading) * step, radius)` → `undefined`, and the
  common case costs one point test.
- Otherwise walk a **fixed fan** of offsets — ±π/8, ±π/4, ±3π/8, ±π/2 — in a fixed
  order, and return the first whose destination clears. That is at most 8 extra
  point tests, only for a unit actually about to hit something.
- **Side bias, so it does not flip-flop.** A unit with clear ground on both sides
  must pick the same side every tick or it dithers in place. Order the fan by
  `evadeSide(e.id)` — the existing hash in `task/outcomes.ts` — so half the units
  prefer left and half prefer right, deterministically and stably per unit. This
  also stops a column all sliding the same way into each other.
- If nothing in the fan clears, return `undefined` and let the step be taken
  (blocked) — the anti-jam retreat is still there for the genuinely trapped case,
  and Stage 2 must not quietly become a new way to freeze.

**2.3 — wire it into `moveEntity`,** after `dist`/`step` are computed and *before*
the position is written:

- Skip entirely when `step >= dist` (the arrival branch) or when
  `dist <= arrivalThreshold` — a unit that is landing on its waypoint must land on
  it, not slide off it. This is what keeps the tolerance rule intact.
- On a slide, `e.heading` is set to the driven direction, as today. It has to be:
  the renderer draws it and `maybeStartRetreat` derives `retreatAngle` from it.
- The waypoint is **not** rewritten. A* stays the global planner; the slide only
  bends this tick's step. That is what keeps a unit from being walked in circles
  around a concave wall.

**2.4 — what stays.** `separationSystem` is untouched and remains the corrective
layer — it is also the only thing that shoves `disabled` hulls out of the way, so
it cannot be folded into this.

**Gate.** Retreats/minute **at least halved** (< 35 from ~70) on both match types,
`stalledTickShare` down materially, and `overlapPairsPerTick` / `meanMinGapPx` no
worse — a unit sliding sideways must not be shoving its neighbours into each
other. If retreats/minute barely move, **stop and rewrite the todo**: the
terrain-contact hypothesis will have been falsified, and Stage 3 must not be
attempted on a wrong diagnosis.

## Stage 2 (rewritten) — units step around units

**Built.** `client/src/engine/systems/avoidance.ts` (`steerAround`), called from
`moveEntity` before the position is written, plus
`client/src/engine/systems/avoidance.test.ts` (7 invariants).

`steerAround(self, neighbours, heading, step)` returns the heading to actually
drive, or `undefined` when the straight step is clear — one distance test per
neighbour in the common case. When the proposed position would land inside a
neighbour's hull it tries a fixed fan (π/8, π/4, 3π/8, π/2), **turning away from
the side the blocker is on** and falling back to a per-id hash when the blocker is
dead ahead. Never past a right angle, so a deflection can never become a reversal.
Two deliberate refusals:

- **An existing overlap is not a blocker.** Separation owns those, and treating
  one as a wall would pin a robot inside the very overlap being resolved.
- **A walled-in robot gets `undefined`,** not a freeze: it presses on and the
  anti-jam ladder deals with it. A preventive step must not become a second way
  to stop a unit dead.

Measured on the headless match, same three seeds, 9767 ticks:

| | before | after |
|---|---|---|
| retreats / minute | 81.64 | **68.41** |
| retreats where the step was undone | **0.47** | **0.00** |
| overlapping pairs / tick | 0.08 | **0.00** |
| "touching (22–30 px)" bucket | 167 | **13** |
| retreats with a robot inside 24 px | 0.26 | **0.02** |
| robot-ticks retreating | 6641 | 6067 |
| stalled robots (avg) | 0.62 | 0.50 |
| share of ticks with a stall | 0.33 | **0.44** |

**The deadlock is gone** — the population this stage was aimed at, 47% of all
retreats, now reads zero, and robots no longer overlap at all. **The headline
number moved much less: 16%.** Removing the deadlock exposed a second population
that it had been masking, and this is where the work stands:

- Every remaining retreat is `noStep` — the robot's own `moveEntity` produced
  under 0.5 px — with a valid destination, nobody within 24 px and no rock.
- `stalledTickShare` rose while `avgStalledRobots` fell (0.62 → 0.50): fewer
  robots stalled at once, over more ticks. Pile-ups became idling.
- Confirmed on screen exactly as predicted: "touching (22–30 px)" 61 → **4**,
  overlapping 8 → **0**, `undoneShareOfRetreats` 0.47 → **0**, retreats/minute
  71.44 → 74.85 — i.e. unmoved, inside a solo series that spans 61–100.

### Stage 2b — the other half: a goal the pathfinder already refused

Found by writing the retreat check itself into the per-robot trace, so both halves
of one tick could be read together:

```
step=0.00 pos=1808.0,1776.0 dest=none path=0 goalDist=-      (x7 ticks)
>>> RETREAT CHECK goal=1776,1776 goalDist=32.0 dest=1808,1776 path=1 prog=defendBase
```

The destination **is where the robot already stands**. The order was to a tile one
step west; that tile is blocked, so `findPath` snapped the goal to the nearest free
tile — the robot's own — and returned a single waypoint at its feet. `moveEntity`
arrives instantly without moving, clears the goal, and next tick the task layer
issues the same order again. Meanwhile `maybeStartRetreat`, which runs *before* the
move, sees a goal 32 px away and no progress, and calls it a jam. Forever.

The tell was `goalStreakAtRetreat`: **406 retreats out of 406** fired at a robot
that had held a goal for *zero* consecutive ticks — it reached the end of its route
every single tick.

So the anti-jam was measuring the distance to the goal that was **asked for**,
while movement had already correctly concluded it arrived at the one that is
**reachable**. The unreachable remainder — up to a whole tile — was charged to the
robot as stagnation. One line, in `maybeStartRetreat`:

```ts
const route = m.path && m.path.length > 0 ? m.path[m.path.length - 1] : m.goal;
if (route && distance(pos.x, pos.y, route.x, route.y) <= settling) { m.stuckTime = 0; return; }
```

Pinned by "does not retreat a robot whose goal was snapped onto the tile it stands
on" in `movement.test.ts`.

### Where it ends up

Headless real match, three seeds, 9767 ticks:

| | baseline | + stage 2 | + stage 2b |
|---|---|---|---|
| retreats / minute | 81.64 | 68.41 | **0** |
| robot-ticks retreating | 6641 | 6067 | **0** |
| retreats where the step was undone | 0.47 | 0.00 | — |
| overlapping pairs / tick | 0.08 | 0.00 | **0.00** |
| **robots genuinely stalled (avg)** | — | — | **0.01** |

`stalledTickShare` reads 0.84 and `avgStalledRobots` 1.79 at the end, and both are
the probe's own metric repeating the bug that was just fixed: they count a robot as
stalled by distance to its *requested* goal. Measured against the end of its route
instead — `avgTrulyStalledRobots` — it is **0.01**. What the old numbers called a
jammed army is robots standing at the posts they were sent to.

The anti-jam ladder is not disabled, only unemployed: both existing retreat tests
still pass, so a robot with somewhere to be and no way to get there still backs
out. There is simply almost nothing left for it to catch.

**What that 0.01 still hid is resolved: it was the sampler, not the game.** A
whole-match invariant test caught a robot standing still for 599 ticks — 20
seconds — holding a route whose end is hundreds of pixels away, with the retreat
never firing at it. The robot was standing in a **finished match**: the invariant
matches end at tick ~3000, `GameScene.update` freezes everything but explosions
after `gameOver`, and the test kept sampling the freeze-frame to tick 3600
(599 = 3600 − 3001). Measured only while the match is live, the worst
no-progress streak with a live route is 13 ticks. The full unwind — every
contradictory number explained by staleness — is in
**`.docs/issues/stalled-robot-with-a-live-route.md`**; the invariant is restored
in `match.test.ts` with a `gameOver` guard and is green.

### Also fixed here, found on the way

**A goal with no route to it never re-paths.** `setGoal` matched its cache on the
goal tile alone, so a robot whose `findPath` came back empty kept `m.goal` with no
`m.destination`, and the task layer re-issuing the same goal every tick hit the
early return every tick — for the rest of the match. The cache now requires a
destination as well as a matching tile. The retreat's own behaviour is untouched:
`movement.test.ts` documents "a goal it cannot path to… exactly the jam" as
deliberate, and an attempt to suppress that retreat was reverted when the test
caught it.

## Stage 3 — retire the anti-jam retreat (gated on Stages 1 and 2)

**Files:** `client/src/config/gameConfig.ts` (`behavior.stuckAfter`,
`retreatSeconds`), `client/src/engine/systems/movement.ts`,
`client/src/engine/systems/movement.test.ts`.

Do **not** start this before Stages 1 and 2 are measured. Right now
`maybeStartRetreat` is load-bearing, however badly.

**3.1 — first, just turn it down.** Raise `stuckAfter` (0.4 s) and shrink
`retreatSeconds` (0.5 s), re-measure. If units still arrive, the crutch was
carrying less than it looked; if they start freezing, Stages 1–2 did less than the
numbers suggested.

**3.2 — then replace the backwards drive with a ladder** (from Stage B3 of
`movement-refactor.md`, now cheaper because 2 exists):

1. stagnation (same `stuckAfter` / `stuckEpsilon` counter) → **re-path**: clear the
   `setGoal` tile cache and run a fresh A*, since the world may have changed (a
   base died, a crowd dispersed);
2. same path, still not moving → **sideways yield**: one hull-length step
   perpendicular to the course, side by `evadeSide(id)`;
3. only then the short backwards drive, as the last rung.

**3.3 — keep both exceptions bought with blood** in
`.docs/issues/formation-jitter-and-narrow-passes.md`: a parked `Idle` robot with no
goal never twitches, and a robot within `radius * 2` of its goal and merely jostled
by its own side is not jammed. Both tests are load-bearing for formations.

**3.4 — keep the base-escape case.** A robot inside a base footprint retreats
straight out along the base→robot vector; that is the case `findPath` also
special-cases, and it is exactly what the retreat was *meant* to be.

## Step 4 of the todo — stays rejected

Nothing in the baseline justifies velocity-space avoidance (RVO/ORCA) at ~7 moving
robots and a 35 px mean closest pair; lockstep also rules out a WASM crowd library.
If unit counts grow by an order of magnitude, re-measure `overlapPairsPerTick` and
`meanMinGapPx` first — those are the numbers that would reopen it, not intuition.

## What must be left behind (permanent tests)

A regression that costs 70 retreats/minute should break the build, not the game —
the way `formation.test.ts` holds the slot-spacing invariant.

- **`pathfinding.test.ts` (new)** — on a map with a diagonal obstacle edge: the
  smoothed path touches nothing (`hasClearance` holds along every leg), is no
  longer than the raw staircase, has strictly fewer points on a diagonal, ends at
  the *same exact* final point, and is returned unsmoothed when the start tile is
  blocked (escape hop intact).
- **`avoidance.test.ts` (new)** — a unit driving straight at a wall gets a
  deflected heading, not the blocked one; two units with different ids deflect to
  different sides; the fan is exhausted → `undefined` (no silent freeze); the same
  inputs give the same output every time (determinism).
- **`movement.test.ts` (extend)** — a robot sent diagonally across open ground
  reaches its goal in a bounded number of ticks with **zero** retreat starts; a
  convoy of 6–9 clears a two-tile gap within a tick budget. The existing four
  base-obstacle tests must pass untouched.
- **`formation.test.ts`** — untouched, and green. It is the Stage-A regression
  guard, and Stage 1 changes the code path it runs on.
- **`client/src/engine/game/determinism.test.ts`** — green.

## Stage 4 — clean up

Delete `client/src/engine/goalProbe.ts`, its four engine call sites and the
`window.__probe` block in `pixi/GameApp.ts`, plus `__scratch.test.ts`. Then:

- Update `.docs/movement.md` — the "Pathfinding" and "Anti-jam retreat" sections
  both describe behaviour this task changes.
- Fold the result into this document (a "Result" section with the before/after
  table, in the shape `movement-refactor.md` uses), mark Stage B of
  `movement-refactor.md` done, and move `.docs/todo/local-avoidance.md` to closed —
  or, if Stage 2's gate failed, rewrite it with what the numbers actually said.

## Verification

Per stage, not once at the end:

1. `npm run build`, `npm test`, `npm run lint` — all clean. `npm run type-check` is
   **not** required: nothing here touches `types/`, `protocol/`, `net/`, `chat/` or
   `server/`.
2. The headless scratch run for the stage's own invariant.
3. `npm run dev`, and a real match: a squad on Attack Base with a `Box` order
   crosses a gap between mountains, opens up on the far side, arrives and fires;
   and a hand-driven single unit sent diagonally past a rock face does not visibly
   back up. Then `__probe()` in the console against the baseline table.
4. On-screen behaviour cannot be confirmed headless, and a stall looks identical
   whatever causes it — step 3 is the check that the numbers describe the game and
   not the harness.

## Order and risks

| Risk | Mitigation |
|---|---|
| Smoothed paths hug walls and make terrain contact worse | measured at the Stage-1 gate; widen the clearance radius to `radius * 1.5` in `setGoal` only |
| The slide dithers a unit in place between two clear sides | fan ordered by `evadeSide(id)` — stable per unit across ticks |
| The slide walks a unit around a concave wall forever | A* stays the planner: the waypoint is never rewritten, only this tick's heading |
| Stage 2 quietly becomes a new way to freeze a unit | exhausted fan returns `undefined` and takes the straight step; the retreat is not removed until Stage 3 |
| Slide fights separation or the formation hold tolerance | slide magnitude ≤ this tick's step; skipped inside `arrivalThreshold`; no arrival tolerance changed |
| Desync from iteration or side choice | miniplex query order + id-hash side, as in `separation.ts` and `outcomes.ts`; `determinism.test.ts` per stage |
| Stage 3 started on a wrong diagnosis | hard gate: Stage 2 must halve retreats/minute or the todo is rewritten instead |

## See also

- `.docs/issues/stalled-robot-with-a-live-route.md` — **what is still open**: a robot that holds a route and makes no progress for 20 s, where the engine and the sampler disagree about whether it moved.
- `.docs/todo/local-avoidance.md` — the diagnosis and the baseline this plan is measured against.
- `.docs/rejected-by-metrics/flow-field-navigation.md` — why the navigation layer was ruled out, and how it was measured.
- `.docs/issues/formation-jitter-and-narrow-passes.md` — the rule about positioners, and the two anti-jam exceptions that must survive.
- `.docs/tasks/movement-refactor.md` — Stage A as shipped, and the original B1–B4 sketch this refines.
- `.docs/movement.md` — pathfinding + movement as they stand.
