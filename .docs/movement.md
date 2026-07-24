# Robot Movement — Implementation Details

Movement is a **hybrid**: pathfinding operates on a discrete tile grid, but the
actual per-tick motion is continuous, float-precision interpolation in pixel
space. The grid never constrains where a robot _sits_ — only how a route
around obstacles is computed.

## Position is continuous, not grid-snapped

`Entity.position` is a `Vec2` — "a point in continuous world space (pixels)"
(`src/types/entities.ts`). There is no grid-index position component; a robot's
`x`/`y` can be any float, at any time, including mid-tile.

## Pathfinding: 8-directional A* over a tile grid

`findPath` (`src/engine/pathfinding.ts`) does the grid part:

1. Converts the start/goal pixel positions to tile coordinates via
   `tileOf` (`src/engine/obstacles.ts`) — `Math.floor(pos.x / tilePx)`.
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

`setGoal` (`src/engine/systems/movement.ts`) calls `findPath` only when the
new goal lands in a different tile than the previous one, since tasks
re-issue a goal every tick — this avoids recomputing A* every frame for a
stationary order.

## Motion: continuous interpolation toward waypoints

`movementSystem` → `moveEntity` (`src/engine/systems/movement.ts`) runs every
fixed step for each entity with `robot`, `position`, `movement`:

- Computes the vector to `movement.destination` (the current waypoint).
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

## Anti-jam retreat (also continuous)

If a moving robot makes ~no net progress for `stuckAfter` seconds (checked by
comparing tick-start positions, not post-move — see comment in
`movementSystem`), `maybeStartRetreat` kicks in: the robot backs off along
`retreatAngle` (away from a base if trapped inside one, or reverse of its
current heading otherwise) for `retreatSeconds`, driven by the same
continuous `pos += direction * speed * dt` stepping as normal movement
(`retreatStep`). After the retreat window it re-paths as usual.

## Obstacle/grid helpers used by all of this

`src/engine/obstacles.ts`:

- `tileOf(pos)` — pixel → tile index (floor).
- `tileCentre(tx, ty)` — tile → pixel (centre of cell).
- `isBlockedGrid(grid, tx, ty)` — bounds-checked lookup; out-of-bounds counts
  as blocked so nothing paths off the map edge.
- `hasLineOfSight(grid, from, to)` — Bresenham walk over tiles, used
  elsewhere (vision/targeting), not by movement itself.
- `withBaseFootprints` — layers living bases as blocked tiles onto a copy of
  the terrain grid, producing the _navigation_ grid (`ctx.navObstacles`),
  kept separate from the terrain-only grid so a destroyed base doesn't reveal
  "rock" underneath it.

## Summary

| Concern         | Representation                                             |
| --------------- | ---------------------------------------------------------- |
| Entity position | continuous float pixels (`Vec2`)                           |
| Pathfinding     | discrete tile grid, 8-dir A*                               |
| Path waypoints  | pixel coordinates (tile centres + exact destination)       |
| Per-tick motion | continuous float interpolation toward the current waypoint |
| Heading         | exact `atan2`, not quantized                               |
| Obstacle checks | tile lookup (`tileOf` + `isBlockedGrid`)                   |
