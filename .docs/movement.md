# Robot Movement — Implementation Details

Movement is a **hybrid**: pathfinding operates on a discrete tile grid, but the
actual per-tick motion is continuous, float-precision interpolation in pixel
space. The grid never constrains where a robot _sits_ — only how a route
around obstacles is computed.

## Position is continuous, not grid-snapped

`Entity.position` is a `Vec2` — "a point in continuous world space (pixels)"
(`@drone-directive/types/entities`). There is no grid-index position component; a robot's
`x`/`y` can be any float, at any time, including mid-tile.

## Pathfinding: 8-directional A* over a tile grid

`findPath` (`client/src/engine/pathfinding.ts`) does the grid part:

1. Converts the start/goal pixel positions to tile coordinates via
   `tileOf` (`client/src/engine/obstacles.ts`) — `Math.floor(pos.x / tilePx)`.
2. Runs A* over `ObstacleGrid` (a `boolean[][]`, tile-indexed), 8-directional,
   with no corner-cutting (a diagonal step is blocked if either flanking
   orthogonal tile is blocked).
3. Reconstructs the path and converts tiles back to pixels via `tileCentre`
   (`(tx + 0.5) * tilePx`) — so every intermediate waypoint is a tile's exact
   centre pixel.
4. The **final** waypoint is the exact requested destination pixel, not a tile
   centre (unless the destination tile itself was blocked, in which case it's
   snapped to the nearest free tile's centre).
5. If the robot's _own_ tile is blocked (e.g. shoved inside a base footprint),
   the path is prefixed with a straight "escape" hop to the nearest free tile
   (`nearestFreeTile`, outward BFS) — otherwise A* has no legal first move.

### String-pulling: the staircase never reaches a robot

Because every intermediate waypoint is a tile *centre*, a raw A* diagonal is a
staircase that swings half a tile either side of the line the robot actually
wants, and every zag is another obstacle edge to drive into. `smoothPath`
(`pathfinding.ts`) drops a waypoint whenever a hull can drive straight from the
last kept point to the one after it, tested with `hasClearance` at hull width.
Greedy, one pass, paid once per search.

Two callers, and they disagree about one thing on purpose. `setGoal` takes the
kept waypoints as they are — `movement.path[0]` is the next destination, and a
head at the robot's own feet would waste a tick arriving at them. `routeFor`
(`systems/task/formation.ts`) prepends its anchor, because a formation *route* is
a line the group projects onto rather than a list to walk.

A robot inside a blocked tile needs no special case: `hasClearance` samples its
own anchor first, so from inside rock it fails for every candidate and the escape
hop above always survives — only the tail is straightened.

`setGoal` (`client/src/engine/systems/movement.ts`) calls `findPath` only when the
new goal lands in a different tile than the previous one, since tasks re-issue a
goal every tick — this avoids recomputing A* every frame for a stationary order.
The cache matches on **a goal tile _and_ an existing destination**: a robot whose
`findPath` came back empty keeps its goal with no route, and matching on the tile
alone made that permanent — the same order arrived every tick and hit the early
return every tick, for the rest of the match.

## Motion: continuous interpolation toward waypoints

`movementSystem` → `moveEntity` (`client/src/engine/systems/movement.ts`) runs every
fixed step for each entity with `robot`, `position`, `movement`:

- Computes the vector to `movement.destination` (the current waypoint).
- Offers the step to `steerAround` (below), which may deflect it around a robot
  standing in the way.
- Steps the robot's float position by `speed * dt` along that vector
  (straight-line interpolation — **no snapping to any grid** during travel).
- Sets `heading = atan2(dy, dx)` each tick, so orientation is exact, not
  quantized to 8 directions.
- When within `gameConfig.robots.arrivalThreshold` of the waypoint, the
  position snaps exactly onto it and the next entry in `movement.path` is
  shifted in as the new destination. When the path is exhausted, the robot
  goes `Idle`.

So a robot's trajectory is: pixel position → straight line to next tile-centre
waypoint → straight line to the next → ... → straight line to the exact
final destination pixel. The grid only decided _which_ tile centres to visit
and in what order; the robot glides between them continuously.

## Local avoidance: stepping around other robots

`steerAround` (`client/src/engine/systems/avoidance.ts`) is the one preventive
step in the pipeline, and it exists because the corrective one is not enough on
its own. `separationSystem` runs *after* movement and pushes apart whatever
already overlaps; a robot driving head-on into a neighbour is therefore moved its
full step forward and then put back **exactly** where it started, every tick,
until the anti-jam retreat fires — 0.9 s later, into the same collision. That
deadlock was 47% of all retreats when it was measured.

Before the position is written, the proposed step is tested against every other
living robot. If it would land inside one, a fixed fan of deflections is tried
(π/8, π/4, 3π/8, π/2), **turning away from the side the blocker is on**, with a
per-id hash breaking the tie when it is dead ahead. Two deliberate refusals:

- an **existing** overlap is not a blocker — separation owns those, and treating
  one as a wall would pin a robot inside the very overlap being resolved;
- when nothing in the fan clears, the robot drives straight anyway. A preventive
  step must never become a second way to freeze a unit; the anti-jam ladder owns
  a genuinely trapped robot.

Never more than a right angle, so a deflection can never become a reversal. It is
not RVO/ORCA and deliberately so: no velocity space, no neighbour prediction, no
reciprocity assumption. At these unit counts the whole defect is "walked into
someone", and the cheapest correct answer is to step around them.

## Anti-jam retreat (also continuous)

If a moving robot makes ~no net progress for `stuckAfter` seconds (checked by
comparing tick-start positions, not post-move — see comment in
`movementSystem`), `maybeStartRetreat` kicks in: the robot backs off along
`retreatAngle` (away from a base if trapped inside one, or reverse of its
current heading otherwise) for `retreatSeconds`, driven by the same
continuous `pos += direction * speed * dt` stepping as normal movement
(`retreatStep`). After the retreat window it re-paths as usual.

This is a **last resort, and it now behaves like one** — a measured match went
from ~70 retreats per minute to none. Three rules keep it that way, and each was
bought with a defect:

- **Progress is judged against the end of the _route_, not the goal that was
  asked for.** `findPath` snaps a goal inside rock or a base footprint out to the
  nearest free tile, and that tile is often the one the robot already stands on:
  the route then ends at its feet, it arrives without moving, and the unreachable
  remainder — up to a whole tile — used to be charged to it as stagnation. That
  single mismatch was every retreat left after local avoidance landed.
- **A robot all but arrived is not jammed**, even if its own side is jostling it —
  otherwise the retreat drags a unit back out of the formation slot it just took.
- **A parked `Idle` robot with no goal never twitches**, but one that has been
  *sent* somewhere may jam like any other.

The one case it is genuinely for: a robot with somewhere far to be and no way to
get there — including one shoved inside a base footprint, which it drives straight
out of.

## Obstacle/grid helpers used by all of this

`client/src/engine/obstacles.ts`:

- `tileOf(pos)` — pixel → tile index (floor).
- `tileCentre(tx, ty)` — tile → pixel (centre of cell).
- `isBlockedGrid(grid, tx, ty)` — bounds-checked lookup; out-of-bounds counts
  as blocked so nothing paths off the map edge.
- `hasLineOfSight(grid, from, to)` — Bresenham walk over tiles, used
  elsewhere (vision/targeting), not by movement itself.
- `hasClearance(grid, a, b, radius)` — whether a *body* of `radius` can drive
  straight from `a` to `b`: sampled every half tile, three probes per sample
  (centre and both flanks). Not `hasLineOfSight`, and the difference is two
  things at once — that one asks about fire, so it reads `sightBlockers`
  (mountains only) and has no width. A diagonal threading exactly between two
  rocks is a clean line of sight and an impassable route.
- `withBaseFootprints` — layers living bases as blocked tiles onto a copy of
  the terrain grid, producing the _navigation_ grid (`ctx.navObstacles`),
  kept separate from the terrain-only grid so a destroyed base doesn't reveal
  "rock" underneath it.

**Every destination handed to a robot must come off `navObstacles`, not
`obstacles`.** The terrain grid does not know about base footprints, and picking a
point from it hands out orders nothing can drive to. `randomPointNear` (guard
posts, patrol) read the terrain grid and routinely posted a guard inside its own
factory: `findPath` snapped the goal back out, often onto the tile the robot
already stood on, and `roamOutcome` only picks a new target once the robot arrives
at this one — which it never would. Measured: robots sat in their own base for up
to 41 seconds.

## Summary

| Concern         | Representation                                             |
| --------------- | ---------------------------------------------------------- |
| Entity position | continuous float pixels (`Vec2`)                           |
| Pathfinding     | discrete tile grid, 8-dir A*                               |
| Path waypoints  | pixel coordinates (tile centres + exact destination)       |
| Path shape      | string-pulled at hull width (`smoothPath` + `hasClearance`) |
| Per-tick motion | continuous float interpolation toward the current waypoint |
| Unit avoidance  | preventive deflection before the step (`steerAround`)      |
| Overlap repair  | corrective push after the step (`separationSystem`)        |
| Heading         | exact `atan2`, not quantized                               |
| Obstacle checks | tile lookup (`tileOf` + `isBlockedGrid`) on `navObstacles` |

## How this is tested

Unit tests cover the pieces — `pathfinding.test.ts` (smoothing never cuts a
corner, keeps the exact goal, preserves the escape hop), `avoidance.test.ts` (a
deflection is bounded, deterministic, and never a freeze), `movement.test.ts` (the
retreat's rules), `obstacles.test.ts` (`hasClearance`).

None of them can see the defects that only appear where several correct-looking
parts meet — the guard-post one above needed four. Those are covered by
`client/src/engine/game/match.test.ts`: whole-match invariants, played headless
through the real pipeline with both seats on the bot and a fixed seed. The engine
imports no Pixi, React or store, so a match is `startMatch` plus a loop.

Two rules for anything added there. **Assert invariants, never numbers** — retreat
counts and match lengths move with every balance change, "no robot is trapped"
does not. And **stop sampling when the match is decided**: after `gameOver` the
scene freezes the simulation deliberately, and a robot's route, `state` and
`prevX` all stay frozen with it — stale, mutually consistent and meaningless. An
invariant that keeps reading past that point measures the freeze-frame and reports
a stall that never happened. See
`.docs/issues/stalled-robot-with-a-live-route.md`.
