# A robot stands still for 20 seconds holding a route it never drives

**2026-08-21. RESOLVED — same day.** Not a game defect. The robot was standing in
a **finished match**: both invariant matches end at tick ~3000 (`gameOver`,
winner=ai, seeds 1 and 7), and after that `GameScene.update` deliberately runs
nothing but `explosionSystem` — the freeze the outcome transition holds the
camera on. The invariant test kept ticking and sampling to 3600, measuring a
stopped simulation for the remaining ~600 ticks. The worst observed stay, 599
ticks, is exactly `3600 − 3001`.

Every contradiction in this file dissolves at once, because every "engine" field
in the dump was a stale leftover of the last tick `movementSystem` actually ran:

- `moved=0.000` — true; nothing runs, nothing moves.
- `engineMoved` = exactly one chassis step — `prevX` is written to the robot's
  *start-of-tick* position, so after the last processed tick it sits precisely
  one full step behind, forever.
- `pushedBack=0.00` — `afterMove` is from that same last tick and equals the
  final position.
- `stuckTime=0.00`, `state=moving` — stale; the robot drove a full step on its
  last processed tick.
- The retreat never fires because `maybeStartRetreat` never runs again.
- Several robots per match, all programs, all chassis — **every** surviving
  robot freezes on the same tick.
- "The robot is in `robots(ctx.world)`" — of course; game over removes nothing.

The "not processed" hypothesis was therefore *correct*, and the mechanism was
hiding in plain sight: not a query dropout mid-tick, but the whole pipeline
stopping at `checkGameOver`. Proved by step 2 below exactly as prescribed — a
per-tick visited-id set in `movementSystem` plus a `gameOver` listener in the
harness; the visited set itself went stale on the same tick as everything else,
which is what pointed at the pipeline rather than the loop.

**The fix is in the sampler, not the game.** `playMatch` in
`client/src/engine/game/match.test.ts` now subscribes to `gameOver` and stops
sampling the tick the match is decided. The removed invariant — *no robot holds
a route it makes no progress along*, 300-tick threshold — is restored and green:
measured while the match is actually live, the worst no-progress streak with a
live route is **13 ticks (0.4 s)** on seed 1 and 1 tick on seed 7. There is
nothing left under `avgTrulyStalledRobots` 0.01.

The lesson to file next to "bucket the distribution": **an invariant sampled
over a whole match must know when the match ended.** A simulation that stops on
purpose is indistinguishable, field by field, from a simulation that wedged.

Everything below is the investigation as it stood, kept for the record.

---

**2026-08-21.** Open. Found while closing `.docs/tasks/local-avoidance.md`, which
took anti-jam retreats from ~70/minute to 0 — this is what is left after that, and
it is **not** the same defect. It is filed separately because every measurement
taken of it so far contradicts every other one, and the next person needs the list
of contradictions more than they need a theory.

> Everything about the surrounding work — the three stages that shipped, the
> baseline, and the two diagnoses that turned out wrong — is in
> **`.docs/tasks/local-avoidance.md`**. Read its "What the measurement actually
> found" section first; this document assumes it.

## The symptom

In a headless bot-vs-bot match (medium map, seed 1), a robot holds a route whose
far end is hundreds of pixels away and makes **no net progress for 599 ticks —
20 seconds**. The anti-jam retreat never fires at it. Several robots do this per
match, across different programs and different chassis.

The instrumented dump, at the 400th consecutive tick of no progress:

```
STUCK robot_75 prog=attackBase   pos=1645,1583 goal=176,1744  dest=1264,1328 path=7 end=240,1744
      retreat=0.00 stuckTime=0.00 speed=60  nearest=148 moved=0.000 engineMoved=2.000
      state=moving afterMove=1645.1,1583.4 pushedBack=0.00
STUCK robot_18 prog=guard        speed=60  nearest=220 moved=0.000 engineMoved=2.000 pushedBack=0.00
STUCK robot_17 prog=attackRobots speed=135 nearest=815 moved=0.000 engineMoved=4.500 pushedBack=0.00
STUCK robot_61 prog=attackBase   speed=42  nearest=368 moved=0.000
```

Read the three numbers that cannot all be true at once:

- `moved=0.000` — the position sampled at the end of this tick is *identical* to
  the one sampled at the end of the previous tick.
- `engineMoved=2.000` — `movement.prevX/prevY`, which `movementSystem` writes at
  the end of every robot's turn, is exactly **one full chassis step** behind the
  current position (2.0 px at speed 60, 4.5 px at speed 135 — never a fraction).
- `pushedBack=0.00` — the position recorded immediately after `movementSystem`
  equals the position at the end of the tick, so **nothing after movement moved
  it**. Not separation, not anything else.

And `stuckTime=0.00`: the engine reset the stagnation clock that tick, i.e.
`maybeStartRetreat` measured `moved >= stuckEpsilon` and concluded the robot was
travelling normally. The engine thinks it is moving. The sampler says it is not.
Both are reading the same two fields.

## The leading hypothesis

`prevX` and the post-move position are **stale by exactly one step**, which is
what you would see if `movementSystem` did not process this robot on these ticks
at all: both values would be left over from the last tick it did.

The trouble is that the obvious ways for that to happen are ruled out:

- The robot **is** in `robots(ctx.world)` at the end of the tick — the sampler is
  iterating that very query when it finds it.
- The only `continue` in `movementSystem` is `isDisabled(e)`, and that branch sets
  `m.prevX = e.position.x` and `m.state = RobotState.Idle`. The dump shows
  `state=moving` and a stale `prevX`, so it is not that branch.
- Excluding disabled robots from the invariant outright did not make the failure
  go away.

So either the robot leaves the archetype query for part of a tick and comes back,
or the staleness has a different cause entirely.

## Ruled out, with the measurement that ruled it out

Each of these was a live theory at some point. None survived.

| Theory | Killed by |
|---|---|
| Jammed against terrain | `contactShareOfRetreats` **0.00–0.02** in every run, on screen and headless: hulls are not touching rock |
| Jammed against a neighbour | `pushedBack=0.00` and nearest robot **148–815 px** away. (This *was* real, was 47% of retreats, and is fixed — see the task doc, stage 2) |
| A goal with no route | `goalNoPathTicks` **0**, `noDestShareOfRetreats` **0** — these robots have a path of 2–7 waypoints |
| Standing inside a base footprint | `fromBaseShareOfRetreats` **0**; also a separate defect, found and fixed (`randomPointNear` read the terrain grid) |
| Dodging (`evadeOutcome` strafing) | **29** stalls out of 3962 were under fire |
| Knocked out by a DEW hit | Excluded explicitly from the invariant; it still failed |
| Possessed by an observer drone | Bots never possess: `aiDrone.ts` forces `possessPulse = false`. The match is all-bot |
| `engine.tick()` running zero sim steps | `GameScene.update` has no accumulator — one call, one step |
| Something after movement moving it back | `pushedBack=0.00`. The only writers of a robot's position are three sites in `movement.ts` and `drone.ts`'s `stepWithWalls`, which needs a non-zero pilot input |

## Where to pick it up

1. **Fix the trace alignment first.** The per-tick history is written at the *end*
   of a robot's turn in `movementSystem`, while the dump fires from
   `maybeStartRetreat` at the *start* of the next one — so the recorded history is
   one tick out of step with the event it is supposed to explain. This cost two
   wrong conclusions on its own. Record the retreat check itself into the same
   buffer (that is what finally cracked the *other* population).
2. **Prove or kill the "not processed" hypothesis directly.** Count the ids
   `movementSystem` actually iterates in a tick and compare that set against
   `robots(ctx.world)` sampled in the same tick. It is a dozen lines and it makes
   the question binary.
3. Only then look for a mechanism.

## How any of this was measured

None of it is visible in a unit test, and none of it is visible on screen — a
stalled robot looks identical whatever the cause. Four instruments did the work,
and they are worth reusing rather than reinventing:

**A real match, played headless.** `new GameEngine()`, `startMatch(settings, seed)`,
both roster seats flipped to `Controller.Bot`, then `engine.tick(1/30)` in a loop.
The engine imports no Pixi, React or store, so vitest's node environment runs it
unchanged, and a seed makes it byte-for-byte reproducible. This is the single most
valuable tool here: it reproduces what the game reports (retreats/minute 81.6
against 61–100 measured in play; `undoneShare` 0.47 against 0.47;
`stalledTickShare` 0.33 against 0.33) **and it needs nobody to play a match**.
An earlier hand-built harness — a squad of eight on bare terrain — disagreed with
every on-screen number and sent the investigation down two blind alleys. Simulate
the real thing, not an approximation of it.

**A disposable probe.** `client/src/engine/goalProbe.ts` plus call sites in
`findPath`, `maybeStartRetreat`, `movementSystem` and `routeFor`, with
`window.__probe()` / `__probeReset()` exposed in dev builds so the same counters
can be read off a real match in the browser. **It is currently in the working
tree, uncommitted, and must be deleted with its call sites** when this is closed
or abandoned.

**A per-tick census, then a per-tick trace.** Counting *what* stalled robots have
in common narrowed the field; printing one robot's state tick by tick is what
actually identified each cause. Every time an aggregate and a trace disagreed, the
trace was right.

**A/B inside one session.** `window.__clearance(f)` switches path smoothing on and
off at runtime, so two matches can be compared back to back under one playing
style. This mattered more than expected: four solo matches on effectively the same
code produced 73, 90, 94 and 100 retreats/minute, so **no effect smaller than
~40% can be seen by comparing one match against a number written down yesterday**.

## The lesson this issue keeps re-teaching

**Bucket the distribution; never average it, never reduce it to a flag.** It has
now hidden a defect three times in the same investigation:

- `meanMinGapPx` 35 px against a 22 px contact distance read as "there is no
  crowd" — it is the closest pair *anywhere on the field*, a property of the
  field, not of the robot that stalled;
- `robotShareOfRetreats`, a binary "is a neighbour within 24 px", sat exactly in
  the middle of the most populated bucket, because separation parks a deadlocked
  pair at *precisely* 22 px — so the pair is almost never caught overlapping;
- `avgTrulyStalledRobots` **0.01** looks like nothing at all, and the invariant
  test found a robot inside that 0.01 standing still for twenty seconds.

The same mistake is recorded in `.docs/rejected-by-metrics/flow-field-navigation.md`
("separate the populations before averaging them"), where it produced a confident
wrong answer the first time.

## The test that found it

A whole-match invariant, played headless — the shape now living in
`client/src/engine/game/match.test.ts`, which keeps one such invariant ("no robot
lives inside a base footprint"). The second one — *no robot holds a route it makes
no progress along* — is what this issue is about, and it was **removed rather than
left red**, because it is not yet known whether it fails on a game defect or on
the sampler's own staleness. The threshold it used was 300 ticks; the worst
observed was 599.

Restoring it is the acceptance test for this issue: it should fail today, and pass
once whatever this is has been fixed.

## See also

- `.docs/tasks/local-avoidance.md` — the whole task: the baseline, the two wrong
  diagnoses, the three stages that shipped, and the numbers behind each.
- `.docs/rejected-by-metrics/flow-field-navigation.md` — why the navigation layer
  was ruled out, and the first time averaging hid the answer.
- `.docs/issues/formation-jitter-and-narrow-passes.md` — the rule about anything
  that positions a robot, and the two anti-jam exceptions that must survive.
- `.docs/movement.md` — pathfinding and movement as they stand.
