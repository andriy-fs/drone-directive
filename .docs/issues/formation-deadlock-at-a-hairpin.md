# A formation that stands still forever at a doubling-back route

> Status: **fixed** — four changes in `client/src/engine/systems/task/formation.ts`.
> Guarded by two suites in `formation.test.ts` (`a squad ordered across the map
> arrives, whatever shape it holds`, `a squad marches round a hairpin`) plus a
> direct test of the release valve; 23 of those cases fail without the fixes.
>
> Three of the four were found one after another, each hiding behind the last, and
> all three the same shape of fault: **every part behaving correctly while the body
> stands still**. That is why the fourth is a valve rather than another rule.

## What was seen

Select a group, give it any shape but `box`, order **Attack base** — and the
squad shuffles in place instead of marching. `box` marches. A right-click
**Move** on the same group marches too. Reported as a regression on
`feat/local-avoidance`; measurement says it is older than that (see below).

The condition the player identified is exact: **it needs a narrow pass on the
route to the objective.** On open ground nothing reproduces.

## What it actually was

At the deadlock, every member is on `hold` with no goal, and stays there:

```
[form] anchor=425,1191 facing=-0.94,0.34 adv=true layout=file depth=-100 lead=64
       marching=492,1259 origin=492,1260
  r_0 at 431,1275 slot=0,0     placed=492,1260 intent=hold
  r_5 at 412,1101 slot=-200,0  placed=667,1154 intent=hold
```

`r_5` is **255 px** from its slot and holds anyway. The reason is the second test
in `slotIntent`:

```ts
const ahead = dx * facing.x + dy * facing.y;
if (vecLength(dx, dy) <= threshold || ahead > slack) return { kind: 'hold' };
```

That test means "this hull has run out in front of its place — wait for the line
rather than reversing into it", and it is correct *provided `facing` points the
way the frame is going*. Here it does not. `facing` came from `facingOf`, which
samples the route **half a `lead` (32 px)** ahead; the frame is projected
**`lead - depthOf(slots)`** ahead — 164 px for the file the pass had narrowed the
shape to. Where the road doubles back round a rock, a 32 px step and a 164 px
step point *opposite ways*.

So the shape is dressed facing away from its own slots, every member reads as
"out in front", every member holds — and a `hold` clears the goal, a cleared goal
freezes the centroid the frame is anchored to, and the frozen centroid re-derives
the identical frame next tick. Nothing in the system can break it: the route is
not stale (the group has not drifted), the objective has not moved, and the
anti-jam retreat does not fire because no robot has a goal to fail to reach.

Measured: 684 px short of the objective, motionless for the remaining 110 s of
the match, on 4 of 12 seeded maps.

## The fixes

### 1. Dress along the way the frame is going

Take the axis from the projection itself, so the two cannot disagree:

```ts
const marching = lead > 0 ? lookAhead(route, anchor, heading, lead - depthOf(slots)) : anchor;
const facing = (lead > 0 ? unitFrom(anchor, marching) : undefined) ?? heading;
```

`facingOf`'s ladder still supplies the axis for a group that is *not* advancing
(where there is no projection to read one off), and still supplies the direction
the projection is measured along. It simply no longer has the last word on which
way a marching shape is dressed.

### 2. A mean is not a place (`anchorOf`)

Split a group around a bend — three hulls up one arm of a pass, three still in the
other — and the average of the six sits in the **rock between them**. The route is
projected from that point, the shape is laid out around it, and
`firstFreePlacement` hands out slots nobody can reach. Measured on a one-tile
hairpin: a wedge parked either side of the bend for 1600 ticks with every member
*holding a live goal*, which is why no "the whole group is holding" test can see
it. When the centroid's tile is blocked the frame anchors on the guide instead — a
real hull, standing on ground it actually drove to, already the member a stopped
frame dresses on.

### 3. A file queues by the road, not by rank (`queueOrder`)

`layoutFor` falls back to single file when the ground will not take anything
wider, and says so in its own words: the file exists so the group *queues up
behind whoever can move*. It was still handing out slots by `marchingOrder`, so
the hull with the front slot could be third in the corridor — with the two ahead
of it correctly dressed in their own slots and no reason to yield, and no room in
one tile of width to permute. For the file, and only the file, slots now go by
distance along the route.

### 4. The release valve

The three above were each found by watching a squad stand somewhere for the rest
of a match, and there is no reason to believe the list is complete. So the last
word goes to a measurement: **if a group has not advanced along its own road for
`stallTicks` (2 s) while it is trying to, the shape stops being in charge for
`releaseTicks` (3 s)** and the cached route is dropped. Every robot keeps what its
own program asked for — the pre-formation behaviour, which is scruffy and
*arrives*. Only while advancing: a group holding its ground in contact is doing
the one thing the formation is for.

This is the same principle `slotIntent` already applies one robot at a time
("**a formation may never take a robot's movement away**"), raised to the group.

## Why it read as "every shape but box"

`depthOf` is the whole of the shape-dependence. A box's cells are centred on
their own middle (`depth` ≈ +4.5), so its frame is projected ~60 px out — close
enough to the 32 px `facingOf` samples that the two rarely disagree. Every other
shape hangs its mass behind the front rank, and a pass narrowing the shape to a
file pushes the projection out to ~164 px, where a hairpin flips the sign.

The bug is **not** new in `b42898c`. The same 12-seed march on `b42898c~1`
deadlocks 8 times against the current branch's 4 — including twice on `box`.
What that commit changed is which shapes fall into it: with the anti-jam retreat
retired and unit paths smoothed, `box` stopped tripping the deadlock entirely,
which is what turned a scattered intermittent fault into the clean, reproducible
"box works, nothing else does" the player reported.

## Measurements

Six mixed hulls, ordered through the real command queue, marching base to base
across generated terrain — 30 seeds × 5 shapes. "Stuck" is 10 s with no net
progress toward the objective, which is the only detector that catches all of
these: the earlier ones (all members goalless, or the centroid not moving) miss
the corner split and the file-order deadlock entirely, because in those the
robots hold live goals and jitter enough to move the mean.

| | never arrived |
|---|---|
| the branch as it stood | 8 / 150 |
| + fix 1 (facing) | — |
| + fixes 2 and 3 (anchor, file order) | 5 / 150 |
| + fix 4 (the valve) | **0 / 150** |

Fixes 2 and 3 lowered the count and moved *which* seeds failed, including onto
`box` — more evidence that the remaining faults were geometry lotteries rather
than one more rule waiting to be written, and the reason the valve exists.

On the hairpin sweep (widths 1–3 × arm gaps 3, 5, 8 × 5 shapes) every shape now
gets round every geometry, and faster than before: the one-tile hairpin that
deadlocked a wedge outright is walked in 743 ticks against the 910 the shapes that
did survive it used to take.

**Not fixed, and out of scope here:** a group with *no* formation at all still
fails most one-tile hairpins. Unformed units have no queue to fall into, pile into
the mouth of the pass and shove each other; `.docs/todo/local-avoidance.md` is
where that belongs.

## Afterwards: the ground itself

Chasing these one at a time was not converging — three, each hiding behind the
last — so the generator now refuses to produce the geometry they need. Every
generated map guarantees a minimum drivable corridor of 3 tiles
(`obstacles.minCorridorTiles`, see `.docs/movement.md`). On sealed terrain the
same 30-seed × 5-shape march reports **0 stuck, 0 groups creeping, and the release
valve firing 0 times**, against 5 creeping runs on the old terrain with all four
fixes in place.

That does not retire anything above. The valve is now the alarm rather than the
cure: base footprints are obstacles the terrain guarantee does not cover, they
come and go mid-match, and robots block each other. A valve that starts firing
again means the ground has a hole in it.

## See also

- `.docs/issues/formation-jitter-and-narrow-passes.md` — the four local-layer
  causes fixed in `9e47bbc`, and the rule about positioners.
- `.docs/todo/local-avoidance.md` — the stage 1–3 work this surfaced under.
- `.docs/movement.md` — pathfinding + movement as they stand.
