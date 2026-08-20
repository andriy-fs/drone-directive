# Flow field instead of A*-per-unit — rejected

> **Closed 2026-08-20 by measurement.** Not built. Kept because the reasoning
> that killed it took two rounds and one of the two arguments was wrong; anyone
> who has the idea again should start from the numbers at the bottom rather than
> re-derive them.
>
> The defect this was aimed at is **real and still open** — it just lives in a
> different layer. See `.docs/todo/local-avoidance.md`.

## The idea

Compute **one field per destination** instead of one path per unit.

1. **Integration pass** — Dijkstra outward *from the goal tile* across the
   `ObstacleGrid`, filling "cost to reach the goal from here" for every tile.
2. **Flow pass** — each tile stores the direction of its cheapest neighbour.
3. **Movement** — a robot reads the vector under its own position and steers
   along it. No stored path, no waypoint list.

The pitch: cost stops scaling with unit count, congestion becomes expressible by
folding unit density into the cost pass, invalidation becomes one flag, and it
stays deterministic (a BFS over an integer grid reproduces exactly on both peers,
unlike a WASM crowd library such as Recast/Detour, which lockstep rules out).

## What we had, and still have

`findPath` in `client/src/engine/pathfinding.ts` — 8-directional A* with an
octile heuristic, returning world-space waypoints. Two callers:

- `setGoal` in `systems/movement.ts` — per robot, deduplicated by goal tile.
- `routeFor` in `systems/task/formation.ts` — the formation frame's march route,
  **cached on the guide** and rebuilt only when the goal tile changes or the
  anchor drifts more than 1.5 tiles off the line.

## The verdict, in order of what actually decided it

### 1. Performance is not an argument — in either direction

Measured over two full matches (grid 60×60 = 3600 tiles, 30 Hz):

| | Group play (4321 ticks) | Solo play (3955 ticks) |
|---|---|---|
| Frame routes | 48 searches, 25.2 nodes each | 0 |
| Unit hops | 4869 searches, 4.0 nodes each | 1570 searches, 9.0 nodes each |
| Total A* work | 20 566 cells | 14 172 cells |
| Fields, cached with the same lifetime | 172 800 cells | — |

Frame routes are **6% of all pathfinding work**, and they are the only thing a
field could replace. A field costs ~8.4× more in total cells — but that is 1200
cells/second against 143. Both are indistinguishable from zero. Nothing about
this decision can rest on cost.

### 2. The group *does* share a destination — the first measurement was circular

The first pass counted distinct goal tiles across **robots** and found 96% of
them unique, which was read as "this game structurally has no shared
destinations". That was wrong, and wrong in a way worth recording: formation
slots are unique per robot *by construction*, so the metric measured a property
of the current design and not a property of the game.

The honest count is distinct **frame** goals: `avgFrameGoals` **0.55, peak 2**.
One field per marching group. A hybrid — field for the frame, A* for personal
goals — is architecturally coherent, and the objection that killed the first
draft does not hold.

(A related overreach from the same draft: the claim that a field
"institutionalises" the shared-goal bug behind root cause #4 of
`.docs/issues/formation-jitter-and-narrow-passes.md`. That bug was a shared
*arrival point*; a field is a shared *gradient* with per-unit arrival. Different
things.)

### 3. What actually kills it: the defect is not group-shaped

Congestion is real and substantial:

- **~70 anti-jam retreats per minute** — the crutch fires more than once a second
- **~40% of ticks** have at least one robot that wants to move and cannot
- 8–10% of robots with a goal are, at any instant, either backing out or stalled

But it is **identical without groups**:

| | Group play | Solo play |
|---|---|---|
| Robots in formation | 3.41 | **0** |
| Live frame goals | 0.55 | **0** |
| Retreats / minute | 69.98 | **73.27** |
| Share of ticks with a stall | 0.43 | 0.39 |
| Stalled robots (avg) | 0.69 | 0.71 |

The second match had no formations at all, no shared routing, every unit moving
alone — and the same congestion, marginally worse. A flow field changes how a
*group* is routed. A defect that reproduces exactly with no group present cannot
be a group-routing defect, so a field cannot fix it.

### 4. Where it really is

`meanMinGapPx` 35–37 against a 22 px contact distance, and ~0.6–1 overlapping
pairs per tick. **Robots are not packed tightly.** There is no crowd, yet there
are constant stalls — so units are jamming against *terrain and base footprints*,
one at a time, not against each other.

That is a single-unit problem: no local avoidance, an A* staircase through tile
centres, and a retreat crutch standing in for a fix. Exactly what the
"Что осталось открытым" section of the formation issue already said, now with a
number on it.

## Limits that would still apply if the idea ever returns

Recorded because they were worked out and remain true, should unit counts or the
design change enough to reopen this.

- **Fields are per-destination.** Many *distinct* goals at once is the
  pathological case and A*'s home turf. Any real end state is **both**, and
  `findPath` is not deleted.
- **Arrival precision drops to one tile.** A field must be cached by goal tile,
  so 32 px becomes the granularity of "arrived". Anything needing an exact stop
  (formation slots, docking, resource points) needs a precise final leg.
- **A field has no concept of "arrived"** — arrows point at the goal forever. The
  stop behaviour that falls out of "the path ran out" must be rebuilt as a radius
  test.
- **Escaping a blocked tile stops working.** `findPath` deliberately hops a robot
  shoved inside a base footprint to the nearest free tile; a field has no value
  at all in blocked tiles. Getting this wrong freezes a unit permanently.
- **Density in the cost pass is the trap, not the prize.** It makes the field
  depend on unit positions, so it must be rebuilt every tick — the saving is
  gone — and it invites oscillation: column enters the gap → gap gets expensive →
  field swings the tail around → gap empties → field swings them back.
- **The field does not know how wide the thing driving on it is.** Arrows thread a
  one-tile gap a five-wide formation cannot use. `hasClearance` and the fit
  checks in `formation.ts` survive unchanged; two unit classes with different
  clearances mean two fields per destination.
- **Everyone drives identically.** A shared map of arrows produces one shared
  trajectory; the incidental spread of independent A* results has to be added
  back deliberately.
- **Invalidation fires on everything at once.** `navGrid.ts` rebuilds
  `navObstacles` when a base dies; at that instant every cached field is garbage,
  and one tick owes as many full floods as there were live destinations.
- **The determinism trap.** The field is a pure function of grid + goal and is
  safe. The optimisation it invites — "only rebuild two fields per frame" —
  **breaks lockstep**, because peers run different frame rates. Any budgeting
  must key off the tick number, never frame time.
- **No local minima.** Worth stating because an earlier draft got it wrong: a full
  Dijkstra integration from the goal has none, descent always reaches the goal.
  The real dithering risks are the density oscillation above and units sticking
  in corners once the field vector is summed with the separation impulse.

## How it was measured

A temporary `client/src/engine/goalProbe.ts` plus four call sites (a search-kind
tag in `routeFor`, a search counter and an expansion counter in `findPath`, a
retreat counter in `maybeStartRetreat`, and a per-tick sweep at the top of
`movementSystem`), with `__probe()` / `__probeReset()` exposed on `window` in dev
builds. Two matches were played: one driving groups with formation orders, one
moving units individually.

The first version of that probe measured a single aggregate and produced a
confident wrong answer. The lesson is the same one the formation issue records:
**separate the populations before averaging them**, and check whether the metric
could have come out any other way under the current design.

## See also

- `.docs/todo/local-avoidance.md` — the defect this was aimed at, with the
  baseline these numbers established.
- `.docs/issues/formation-jitter-and-narrow-passes.md` — the symptoms, and the
  four local-layer root causes fixed in `9e47bbc`.
- `.docs/movement.md` — pathfinding + movement as they stand.
