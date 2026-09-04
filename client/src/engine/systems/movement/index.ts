import { gameConfig, worldPixelSize } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { RobotState, TaskType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../../utils/math';
import type { BaseEntity, Navigable, RobotEntity } from '../../ecs/archetypes';
import { isAlive } from '../../ecs/guards';
import { bases, robots } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import { isBlockedGrid, tileOf } from '../../obstacles';
import { findPath, smoothPath } from '../../pathfinding';
import { steerAround } from './avoidance';
import { isArming, isDisabled } from '../../status';
import { baseFootprintContains, pilotedHullIds } from '../../targeting';

/**
 * Sets a robot's navigation goal, pathfinding around obstacles. Skips the A*
 * recompute when the goal is still in the same tile (tasks re-issue every tick).
 *
 * The route is string-pulled before it is stored: `findPath` walks tile centres,
 * so an unsmoothed diagonal is a staircase that swings half a tile either side of
 * the line the robot wants, and every zag is another obstacle edge to drive into.
 * The formation frame has had this since `9e47bbc`; this is the same pass for a
 * robot's own path (`.docs/tasks/local-avoidance.md`, stage 1).
 *
 * The corridor it demands is exactly hull width, and that was measured rather
 * than assumed: a smoothed leg is only valid from where it was computed — unlike
 * the staircase it replaces it does not run through free tile *centres* — so a
 * wider margin to absorb sideways shove looks like the safer choice. A sweep over
 * eight seeded maps (hull width, 1.5x, 2x, 2.5x, and no smoothing at all) found
 * plain hull width the best of them and the rest non-monotonic, i.e. noise rather
 * than a curve. Widen it only with a measurement that says which population it
 * helps.
 *
 * A robot shoved inside a base footprint needs no special case here: `findPath`
 * prefixes its route with a hop out to the nearest free tile, and `hasClearance`
 * samples the anchor itself first — from inside rock that fails for every
 * candidate, so the hop is always kept and only the tail is straightened.
 */
export function setGoal(ctx: GameContext, entity: Navigable, x: number, y: number): void {
  const m = entity.movement;
  const goalTile = tileOf({ x, y });
  // The cache needs a *route*, not just a goal. A robot whose `findPath` came
  // back empty keeps its goal with no destination, and matching on the goal tile
  // alone made that permanent: the task layer re-issues the same goal every tick,
  // this returns early every tick, and the robot retreats forever without ever
  // asking again — even after the retreat has moved it somewhere a route exists.
  if (m.goal && m.destination) {
    const prev = tileOf(m.goal);
    if (prev.tx === goalTile.tx && prev.ty === goalTile.ty) return;
  }
  // A search that failed is worth remembering. `findPath` is a pure function of
  // (grid, start tile, goal tile), so if none of the three has changed the answer
  // is still "no route" — and re-deriving it is the most expensive thing the
  // engine can do, because a failed search explores every reachable tile. See the
  // `noRoute` field for the numbers.
  const fromTile = tileOf(entity.position);
  const memo = m.noRoute;
  if (
    memo &&
    memo.navVersion === ctx.navVersion &&
    memo.fromTx === fromTile.tx &&
    memo.fromTy === fromTile.ty &&
    memo.goalTx === goalTile.tx &&
    memo.goalTy === goalTile.ty
  ) {
    m.goal = { x, y };
    m.path = undefined;
    m.destination = undefined;
    m.state = RobotState.Idle;
    return;
  }

  const raw = findPath(ctx.navObstacles, entity.position, { x, y });
  const path = smoothPath(ctx.navObstacles, entity.position, raw, gameConfig.robots.radius);
  m.goal = { x, y };
  m.path = path;
  m.destination = path.length > 0 ? path[0] : undefined;
  if (!m.destination) {
    m.state = RobotState.Idle;
    m.noRoute = {
      fromTx: fromTile.tx,
      fromTy: fromTile.ty,
      goalTx: goalTile.tx,
      goalTy: goalTile.ty,
      navVersion: ctx.navVersion,
    };
  } else {
    m.noRoute = undefined;
  }
}

/** Cancels navigation (used when a robot stops to engage). */
export function clearGoal(entity: Navigable): void {
  const m = entity.movement;
  m.goal = undefined;
  m.path = undefined;
  m.destination = undefined;
}

/**
 * Advances every robot along its path for one simulation step.
 *
 * Two implementations, chosen by `behavior.orca.enabled`, and they are kept
 * **separate rather than merged** on purpose. The original path is sequential:
 * robot *i* moves before robot *i+1* looks around, so *i+1* avoids where *i* has
 * already got to. ORCA is a batch: every agent must be solved against one
 * snapshot, or reciprocity is not reciprocal. Those two orderings cannot both come
 * out of one loop, and a shared loop with a flag in it would produce a third
 * behaviour that is neither. Keeping them apart is also what makes the flag-off
 * path provably a no-op — the A/B harness reproduces its replay hash bit for bit.
 *
 * The duplication is temporary and goes away with `steerAround`.
 */
export function movementSystem(ctx: GameContext, dt: number): void {
  if (gameConfig.behavior.orca.enabled) orcaPass(ctx, dt);
  else sequentialPass(ctx, dt);
}

/** The original one-at-a-time loop: decide, step, next robot sees the result. */
function sequentialPass(ctx: GameContext, dt: number): void {
  const list = robots(ctx.world).entities;
  const piloted = pilotedHullIds(ctx);

  for (const e of robots(ctx.world)) {
    const m = e.movement;

    // Knocked out by a directed-energy hit, or a kamikaze standing on its own lit
    // fuse: either way it doesn't drive. The anti-jam bookkeeping is kept current
    // anyway — left stale, standing still for eight seconds would read as a jam and
    // send the robot into a retreat the instant it recovers. Separation still shoves
    // it around, on purpose: a frozen cluster must not become a wall its own side has
    // to path around, and a bomb nudged a few px off its mark still detonates on it.
    if (isDisabled(e) || isArming(e)) {
      parkStationary(e);
      continue;
    }

    // Under a pilot: `droneSystem` already moved this hull and recorded what it
    // drove, so this pass has nothing to say about it and must not overwrite the
    // velocity with a reading of its own inaction. Checked *after* `isDisabled`,
    // because a hull knocked out under its pilot answers neither stick nor
    // trigger and `parkStationary` is the truthful account of it.
    //
    // The anti-jam bookkeeping is deliberately left frozen rather than kept
    // current the way `parkStationary` keeps it: a pilot leaning on a wall is not
    // jammed, and the retreat is not a thing to do to someone holding the stick.
    // Harmless on release, because possession cleared the goal — an Idle hull
    // without one zeroes `stuckTime` at the first gate of `maybeStartRetreat`.
    if (piloted.has(e.id)) continue;

    // Net progress is measured over a *full* tick: compare the start-of-tick
    // position against last tick's start (which folds in the robot's own
    // movement plus any separation push). Recording it post-move would only
    // capture the separation gap and flag freely-moving robots as stuck.
    const startX = e.position.x;
    const startY = e.position.y;

    if ((m.retreatTime ?? 0) <= 0) maybeStartRetreat(ctx, e, dt, false);
    if ((m.retreatTime ?? 0) > 0) retreatStep(e, dt);
    else moveEntity(e, list, dt);

    recordTick(e, startX, startY, dt);
  }
}

/** What phase A decided a robot is doing, read back by phase B. */
const PLAN_NONE = 0;
const PLAN_SNAP = 1;
const PLAN_DRIVE = 2;
const PLAN_RETREAT = 3;
/** Knocked out: registered so others flow around it, but nothing to commit. */
const PLAN_PARKED = 4;
/** Under a pilot: `droneSystem` already drove it, so likewise nothing to commit. */
const PLAN_PILOTED = 5;

/**
 * How much of its preferred speed the solver must have taken away before a
 * standstill counts as *giving way* rather than *jamming*.
 *
 * Feasibility alone is not enough, and assuming it was is a mistake worth
 * recording: a lone robot pinned against geometry is solved feasibly at full
 * speed every tick — ORCA has no opinion about it — so treating "feasible" as
 * "yielding" suppressed the retreat for exactly the robot the anti-jam exists to
 * rescue, and `movement.test.ts` caught it. The honest question is not "could the
 * solver satisfy its constraints" but "did the solver slow this unit down".
 */
const YIELD_SPEED_FRACTION = 0.9;

/**
 * Phase A→B scratch. Plain arrays reused across ticks: after the first few they
 * never grow, so this allocates nothing in the steady state. Safe as module state
 * because it is filled and drained inside one synchronous `orcaPass` call and
 * never read across ticks — unlike the solver's buffers, which are per-match and
 * live on the context.
 */
const planEntity: RobotEntity[] = [];
const planKind: number[] = [];
const planAgent: number[] = [];
const planStartX: number[] = [];
const planStartY: number[] = [];

/**
 * The batched pass: every robot states its intent against the *pre-move* world,
 * ORCA solves them all together, then the moves are committed.
 *
 * Nothing here may write a position before the solve — a neighbour is about to be
 * snapshotted from it — which is why the arrival snap and the `path.shift()`
 * waypoint advance happen in phase B rather than where they sit in `moveEntity`.
 */
function orcaPass(ctx: GameContext, dt: number): void {
  const orca = ctx.orca;
  const piloted = pilotedHullIds(ctx);
  orca.begin(dt);
  let n = 0;

  for (const e of robots(ctx.world)) {
    const m = e.movement;
    const pos = e.position;

    if (isDisabled(e) || isArming(e)) {
      parkStationary(e);
      // Still registered, and passive: a frozen hull is an obstacle its own side
      // has to flow around, and one nobody can expect to yield. It still takes a
      // plan slot — the commit loop walks slots by index, so skipping one here
      // while advancing the count would hand it the *previous* tick's entity.
      planEntity[n] = e;
      planKind[n] = PLAN_PARKED;
      planAgent[n] = orca.register(e, 'passive', 0, 0, 0);
      planStartX[n] = pos.x;
      planStartY[n] = pos.y;
      n++;
      continue;
    }

    // Under a pilot — see the sequential pass for why this pass keeps its hands
    // off. Registered *passive* at the velocity `drivePossessed` just wrote: a
    // player-driven machine is not negotiating, so its own side owes the whole
    // correction, which is the same treatment a retreating hull gets and for the
    // same reason. It still takes a plan slot, as a disabled hull does, because
    // the commit loop walks slots by index.
    //
    // Snapshotted one step (~2 px at 30 Hz) further on than everyone else, since
    // `droneSystem` has already moved it. That is where the hull actually is this
    // tick; the alternative is running `droneSystem` after this pass, and it sits
    // where it does so it can override the target the Idle resolver set.
    if (piloted.has(e.id)) {
      planEntity[n] = e;
      planKind[n] = PLAN_PILOTED;
      planAgent[n] = orca.register(e, 'passive', m.velX, m.velY, 0);
      planStartX[n] = pos.x;
      planStartY[n] = pos.y;
      n++;
      continue;
    }

    const startX = pos.x;
    const startY = pos.y;
    // The jam check runs in phase B, not here: whether standing still is a jam or
    // a deliberate yield is only knowable once the solver has answered.
    let kind = PLAN_NONE;
    let prefX = 0;
    let prefY = 0;
    let dist = 0;

    if ((m.retreatTime ?? 0) > 0) {
      // A retreating hull is not negotiating — it is backing out of a jam on a
      // fixed bearing. Registered passive at the velocity it is about to drive, so
      // everyone else can see it coming.
      const ang = m.retreatAngle ?? 0;
      kind = PLAN_RETREAT;
      prefX = Math.cos(ang) * m.speed;
      prefY = Math.sin(ang) * m.speed;
    } else {
      const dest = m.destination;
      if (dest) {
        const dx = dest.x - pos.x;
        const dy = dest.y - pos.y;
        dist = vecLength(dx, dy);
        const step = m.speed * dt;
        if (dist > gameConfig.robots.arrivalThreshold && step < dist) {
          kind = PLAN_DRIVE;
          // Heading only for a real drive. Writing it for the arrival branch too
          // — as this once did — points the hull along the last <=2 px to its
          // waypoint, and for a parked unit whose goal is re-issued at its own
          // feet that is `atan2` of separation jitter: a hull visibly spinning
          // on the spot while standing still.
          e.heading = Math.atan2(dy, dx);
          prefX = (dx / dist) * m.speed;
          prefY = (dy / dist) * m.speed;
          // Carry part of last tick's choice forward, so the solver cannot swap
          // sides of a neighbour every tick and weave the hull down the map.
          const inertia = gameConfig.behavior.orca.prefInertia;
          if (inertia > 0) {
            const bx = prefX * (1 - inertia) + m.velX * inertia;
            const by = prefY * (1 - inertia) + m.velY * inertia;
            const blended = vecLength(bx, by);
            if (blended > 1e-6) {
              // Direction is damped; magnitude is not — a hull still asks for its
              // full speed, or inertia would quietly become a speed limit.
              prefX = (bx / blended) * m.speed;
              prefY = (by / blended) * m.speed;
            }
          }
        } else {
          // Landing on the waypoint. Registered as a *hold* — solved, with the
          // landing velocity as its preference — and committed by `snapOrYield`:
          // undisturbed, the solver returns the preference untouched and the hull
          // lands exactly (the formation layer's tolerances are statements about
          // where robots actually stop); pressed by a mover, it gives way this
          // tick and lands the next. A unit parked *on* its goal while the task
          // layer re-issues that goal every tick lives in this branch permanently,
          // and registering it passive made it a wall — the second half of the
          // open-field deadlock (see `.docs/investigation/`).
          kind = PLAN_SNAP;
          prefX = dx / dt;
          prefY = dy / dt;
        }
      }
    }

    // `PLAN_NONE` (parked with no route, preference zero) and `PLAN_SNAP` (landing
    // this tick) register as *holds*: solved, so they give way when pressed
    // instead of standing as walls movers owe 100% of the correction to. See the
    // `Intent` doc in `orca/steering.ts` for the deadlock this prevents.
    const intent = kind === PLAN_DRIVE ? 'drive' : kind === PLAN_RETREAT ? 'passive' : 'hold';
    const agent = orca.register(e, intent, prefX, prefY, dist);
    planEntity[n] = e;
    planKind[n] = kind;
    planAgent[n] = agent;
    planStartX[n] = startX;
    planStartY[n] = startY;
    n++;
  }

  orca.solve(ctx.navObstacles);

  for (let i = 0; i < n; i++) {
    const e = planEntity[i];
    const kind = planKind[i];
    if (kind === PLAN_PARKED) continue; // `parkStationary` already did its bookkeeping
    if (kind === PLAN_PILOTED) continue; // `drivePossessed` already moved it and recorded it

    // The jam check runs **before** the move, exactly as the sequential pass does.
    // It compares the current position against `m.prevX`, which still holds the
    // *previous* tick's start, so it measures net progress over a full tick
    // including separation's shove. Running it after the commit — as an earlier
    // draft did — leaves `recordTick` having already reset `prevX` to this tick's
    // start, so it reads the 2 px the robot just drove and concludes all is well.
    // A robot pinned in place then never retreats, which `movement.test.ts`
    // caught as "still retreats a robot with a long way to go and no way through".
    //
    // `PLAN_NONE` is a robot holding a goal it has no route to — the exact case
    // the anti-jam exists for, so it reaches the check too.
    if (kind !== PLAN_RETREAT && (e.movement.retreatTime ?? 0) <= 0) {
      maybeStartRetreat(ctx, e, dt, isYielding(ctx, e, kind, planAgent[i]));
    }

    // A retreat that starts *this* tick takes effect immediately, as it always
    // has. Its neighbours were told about the velocity it planned before the
    // check, which is one tick stale — harmless, and the alternative is a second
    // solve.
    // The orbit ladder runs after the standstill one and only for a hull that is
    // actually driving; it may start a retreat of its own (the escalation), which
    // the dispatch below then honours the same tick.
    const press =
      kind === PLAN_DRIVE && (e.movement.retreatTime ?? 0) <= 0 && maybePress(e, dt);

    if ((e.movement.retreatTime ?? 0) > 0) retreatStep(e, dt);
    else if (kind === PLAN_SNAP) snapOrYield(ctx, e, planAgent[i], dt);
    else if (kind === PLAN_DRIVE) {
      if (press) pressStep(ctx, e, dt);
      else driveSolved(ctx, e, planAgent[i], dt);
    } else if (kind === PLAN_NONE) driveHold(ctx, e, planAgent[i], dt);
    if (kind !== PLAN_DRIVE) {
      // Not trying to travel this tick: whatever the anchor was watching is over.
      e.movement.jamAnchorX = undefined;
      e.movement.jamAnchorY = undefined;
      e.movement.jamAnchorAge = 0;
    }
    recordTick(e, planStartX[i], planStartY[i], dt);
  }
}

/**
 * True when ORCA deliberately slowed this unit: it found a feasible velocity and
 * that velocity is materially below the speed the unit asked for. Standing still
 * for that reason is the avoidance layer working, not a jam.
 */
function isYielding(ctx: GameContext, e: RobotEntity, kind: number, agent: number): boolean {
  if (kind !== PLAN_DRIVE) return false;
  if (ctx.orca.fellBack(agent)) return false; // boxed in — that *is* a jam
  const vx = ctx.orca.velocityX(agent);
  const vy = ctx.orca.velocityY(agent);
  return vecLength(vx, vy) < e.movement.speed * YIELD_SPEED_FRACTION;
}

/**
 * Commits the arrival branch. Undisturbed — the solver handed the landing
 * velocity back untouched — the hull lands exactly on the waypoint and takes the
 * next one, as the formation tolerances require. Deflected, it drives the solved
 * velocity instead and keeps the waypoint: it is giving way to a mover this tick
 * and will land when the pressure passes. Heading is left alone either way —
 * covering the last two pixels, or being jostled off them, is not a turn.
 */
function snapOrYield(ctx: GameContext, e: RobotEntity, agent: number, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const dest = m.destination;
  if (!dest) return;
  const vx = ctx.orca.velocityX(agent);
  const vy = ctx.orca.velocityY(agent);
  // The preference it registered, recomputed: nothing has moved this hull or its
  // waypoint since phase A. An unconstrained solve returns it bit for bit.
  const px = (dest.x - pos.x) / dt;
  const py = (dest.y - pos.y) / dt;
  const ddx = vx - px;
  const ddy = vy - py;
  if (ddx * ddx + ddy * ddy < 1e-12) {
    pos.x = dest.x;
    pos.y = dest.y;
    advanceWaypoint(m);
    return;
  }
  driveHold(ctx, e, agent, dt);
}

/** Commits a solved velocity, refusing one that would drive the hull into rock. */
function driveSolved(ctx: GameContext, e: RobotEntity, agent: number, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  let vx = ctx.orca.velocityX(agent);
  let vy = ctx.orca.velocityY(agent);

  // Only when the constraints were infeasible and ORCA had to pick a
  // least-penetrating velocity: that is the one case it may aim into geometry.
  //
  // The test is a *point* test on where the hull centre lands, deliberately not
  // `hasClearance`. That one sweeps a hull-wide corridor and is built to prove a
  // whole smoothed A* leg is drivable; asked about a 2 px step it probes ±11 px
  // sideways and so returns false for any hull merely walking *alongside* a wall.
  // Using it here froze units solid against every corridor face — 12/12 arrivals
  // fell to 5/12 — while reporting nothing wrong.
  if (ctx.orca.fellBack(agent)) {
    const tile = tileOf({ x: pos.x + vx * dt, y: pos.y + vy * dt });
    if (isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) {
      // Fall back to the velocity it actually wanted: that one runs along a leg
      // `smoothPath` already proved clear at hull width.
      const dest = m.destination;
      if (!dest) return;
      const dx = dest.x - pos.x;
      const dy = dest.y - pos.y;
      const d = vecLength(dx, dy);
      if (d < 1e-6) return;
      const fx = (dx / d) * m.speed;
      const fy = (dy / d) * m.speed;
      const back = tileOf({ x: pos.x + fx * dt, y: pos.y + fy * dt });
      if (isBlockedGrid(ctx.navObstacles, back.tx, back.ty)) {
        m.state = RobotState.Moving;
        return; // boxed in this tick; the anti-jam ladder owns it from here
      }
      vx = fx;
      vy = fy;
    }
  }

  pos.x += vx * dt;
  pos.y += vy * dt;
  // Heading follows the velocity actually driven, not the one asked for — the
  // renderer draws it and `maybeStartRetreat` reverses it. A hull solved to a
  // standstill keeps its previous heading rather than spinning.
  if (vx * vx + vy * vy > 1e-12) e.heading = Math.atan2(vy, vx);
  m.state = RobotState.Moving;
}

/**
 * Detects a velocity-space limit cycle and answers it by pressing on.
 *
 * The classic anti-jam watches per-tick displacement, and an ORCA limit cycle
 * defeats it: a mover parked in the mouth of a pocket two constraints disagree
 * about jitters ~2 px a tick — above `stuckEpsilon` — inside a cell it never
 * leaves, spinning its heading every tick and never firing the retreat. That is
 * the play-tested "rotates on the spot" defect. The honest measure is *net*
 * travel: an anchor planted where the hull drives, re-planted only when the hull
 * gets `radius * 2` away (the settling distance the arrival check already uses),
 * whose age therefore only grows while the hull is truly going nowhere.
 *
 * The answer once it trips is the one the old layer embodied: drive straight
 * down the route for a moment and let reciprocity do the yielding — neighbours
 * still see this hull as a normal agent and give way, and `separationSystem`
 * still guarantees hulls come apart, which is exactly how `steerAround` squeezed
 * past a parked unit ORCA's hold distance cannot clear. Every threshold reused
 * here is one that was already measured: the fuse is the yield-patience fuse
 * (`stuckAfter * yieldPatience`), the burst is `retreatSeconds` long.
 */
function maybePress(e: RobotEntity, dt: number): boolean {
  const m = e.movement;
  const pos = e.position;
  if ((m.pressTime ?? 0) > 0) {
    m.pressTime = (m.pressTime ?? 0) - dt;
    return true;
  }
  const escape = gameConfig.robots.radius * 2;
  const ax = m.jamAnchorX;
  const ay = m.jamAnchorY;
  if (ax === undefined || ay === undefined || vecLength(pos.x - ax, pos.y - ay) > escape) {
    m.jamAnchorX = pos.x;
    m.jamAnchorY = pos.y;
    m.jamAnchorAge = 0;
    m.jamReliefs = 0;
    return false;
  }
  m.jamAnchorAge = (m.jamAnchorAge ?? 0) + dt;
  if (m.jamAnchorAge < gameConfig.behavior.stuckAfter * gameConfig.behavior.orca.yieldPatience) return false;
  m.jamAnchorAge = 0;
  if ((m.jamReliefs ?? 0) === 0) {
    m.jamReliefs = 1;
    m.pressTime = gameConfig.behavior.retreatSeconds;
    return true;
  }
  // The press had its chance at this anchor and the hull is still here — two
  // pressers grinding head-on never part. Escalate to the classic retreat: it
  // physically leaves the anchor circle, which re-arms the whole ladder.
  // `e.heading` still points at the waypoint here (phase A wrote it; no commit
  // has overwritten it yet this tick), so `+ PI` is "back the way it came".
  m.retreatAngle = e.heading + Math.PI;
  m.retreatTime = gameConfig.behavior.retreatSeconds;
  return false;
}

/**
 * One tick of pressing: at the waypoint, leading with a shoulder, refusing only
 * rock. The shoulder's sign is **fixed — the same turn sense for everyone** —
 * and that is the symmetry-breaker, not a per-robot hash. Two hulls meeting on
 * an exactly colinear line stay colinear through every mirror-symmetric relief
 * forever (press into press, retreat into retreat), and a hashed side only
 * breaks that half the time: opposite parities on opposite headings is the same
 * world side, and the mirror survives. The same rotation sense on opposite
 * headings is *always* opposite world sides — the roundabout rule.
 */
const PRESS_SHOULDER = 0.35;

function pressStep(ctx: GameContext, e: RobotEntity, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const dest = m.destination;
  if (!dest) return;
  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const d = vecLength(dx, dy);
  if (d < 1e-6) return;
  const ang = Math.atan2(dy, dx) + PRESS_SHOULDER;
  const vx = Math.cos(ang) * m.speed;
  const vy = Math.sin(ang) * m.speed;
  // Same guard as `driveSolved`'s fallback: the leg was proved clear at hull
  // width by `smoothPath`, but the hull may have been jostled off it.
  const tile = tileOf({ x: pos.x + vx * dt, y: pos.y + vy * dt });
  if (isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) return;
  pos.x += vx * dt;
  pos.y += vy * dt;
  e.heading = Math.atan2(vy, vx);
  m.state = RobotState.Moving;
}

/**
 * Commits a parked hull's solved give-way nudge. Deliberately touches neither
 * `heading` nor `state`: being pressed aside is not a manoeuvre, and a parked
 * robot whose hull visibly turned with every jostle would read as broken.
 */
function driveHold(ctx: GameContext, e: RobotEntity, agent: number, dt: number): void {
  const pos = e.position;
  const vx = ctx.orca.velocityX(agent);
  const vy = ctx.orca.velocityY(agent);
  if (vx * vx + vy * vy < 1e-6) return;
  // Same guard as `driveSolved`: an infeasible solve may aim into rock.
  if (ctx.orca.fellBack(agent)) {
    const tile = tileOf({ x: pos.x + vx * dt, y: pos.y + vy * dt });
    if (isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) return;
  }
  pos.x += vx * dt;
  pos.y += vy * dt;
}

/**
 * Shared by both passes: the per-tick bookkeeping of a hull that is not driving
 * this tick — knocked out, or burning a kamikaze fuse.
 */
function parkStationary(e: RobotEntity): void {
  const m = e.movement;
  m.prevX = e.position.x;
  m.prevY = e.position.y;
  m.velX = 0;
  m.velY = 0;
  m.stuckTime = 0;
  m.retreatTime = 0;
  m.state = RobotState.Idle;
}

/**
 * Shared by both passes: what this tick actually drove, before separation gets its
 * say. Measured as a delta rather than derived from heading and speed, so the
 * arrival branch (which may be shorter than a full step) and the retreat both
 * report honestly.
 */
function recordTick(e: RobotEntity, startX: number, startY: number, dt: number): void {
  const m = e.movement;
  m.prevX = startX;
  m.prevY = startY;
  m.velX = (e.position.x - startX) / dt;
  m.velY = (e.position.y - startY) / dt;
}

/** Steps to the next waypoint, or clears the goal when the route is spent. */
function advanceWaypoint(m: RobotEntity['movement']): void {
  if (m.path && m.path.length > 1) {
    m.path.shift();
    m.destination = m.path[0];
    m.state = RobotState.Moving;
  } else {
    m.path = undefined;
    m.goal = undefined;
    m.destination = undefined;
    m.state = RobotState.Idle;
  }
}

/**
 * Detects a jam and starts a retreat: a robot that wants to move (has a goal) or
 * is trapped inside a base, yet made ~no net progress since last tick, backs off
 * for `retreatSeconds` — driving back the way it came (or straight out of a
 * base) — then re-approaches. Legitimately-holding units (no goal, not in a
 * base) and parked idle ones are left alone.
 */
function maybeStartRetreat(ctx: GameContext, e: RobotEntity, dt: number, yielding: boolean): void {
  const m = e.movement;
  const pos = e.position;
  // A parked idle robot must not jitter — but one that has been *sent* somewhere
  // (a right-click move, or a rally point out of the factory) may jam like any
  // other, and a whole production run funnelling through the same door makes
  // that systematic rather than occasional.
  if (e.script.programId === TaskType.Idle && !m.goal) {
    m.stuckTime = 0;
    return;
  }
  const base = baseContaining(ctx, pos);
  if (!m.goal && !base) {
    m.stuckTime = 0;
    return;
  }


  // All but arrived, and merely being jostled by whoever else is standing here:
  // that is not a jam. Backing such a robot out is actively wrong once formations
  // exist — the thing pinning it is its own side closing up around it, and the
  // retreat would drive it out of the line it just spent the march reaching. A
  // real jam is a robot with somewhere far to be and no way to get there, which
  // this leaves untouched.
  //
  // Measured against the end of the *route*, not the goal that was asked for.
  // `findPath` snaps a goal inside rock or a base footprint out to the nearest
  // free tile, and that tile is often the one the robot is already standing on:
  // the route is then a single waypoint at its own feet, it "arrives" without
  // moving, and the unreachable remainder — a whole tile of it — was being
  // charged to it as stagnation. That was every retreat left after unit
  // avoidance landed: 406 of 406 fired at a robot that had held its goal for
  // exactly zero consecutive ticks, because it reached the end of its route
  // every single tick. See `.docs/tasks/local-avoidance.md`.
  const settling = gameConfig.robots.radius * 2;
  const route = m.path && m.path.length > 0 ? m.path[m.path.length - 1] : m.goal;
  if (route && distance(pos.x, pos.y, route.x, route.y) <= settling) {
    m.stuckTime = 0;
    return;
  }

  const moved = m.prevX !== undefined ? vecLength(pos.x - m.prevX, pos.y - (m.prevY ?? pos.y)) : Infinity;
  if (moved >= gameConfig.behavior.stuckEpsilon) {
    m.stuckTime = 0;
    return;
  }

  m.stuckTime = (m.stuckTime ?? 0) + dt;

  // Standing still because the avoidance layer *chose* a slow velocity it could
  // satisfy is not a jam — it is a unit giving way, and half a second of full
  // reverse is the one response guaranteed to make the next approach worse. In a
  // 96 px pass with traffic both ways the unpatient version fired 37 times and
  // cost four of twelve arrivals.
  //
  // But patience is not the same as blindness, and the first attempt at this
  // suppressed the jam check outright, which was wrong in the way a player
  // notices: a pack meeting a rock face would stand *completely still* for 267
  // ticks — nine seconds — before the geometry resolved itself. Yielding buys a
  // longer fuse, not an infinite one.
  //
  // A hull inside a base footprint keeps the short fuse either way: backing
  // straight out along the base→hull vector is what the retreat was built for and
  // no solver replaces it.
  const patience = yielding && !base ? gameConfig.behavior.orca.yieldPatience : 1;
  if (m.stuckTime < gameConfig.behavior.stuckAfter * patience) return;
  m.stuckTime = 0;

  // Retreat: straight out of a base when trapped, else back the way it came.
  m.retreatAngle = base ? Math.atan2(pos.y - base.position.y, pos.x - base.position.x) : e.heading + Math.PI;
  m.retreatTime = gameConfig.behavior.retreatSeconds;
}

/** Drives the robot along its retreat direction at full speed for one step. */
function retreatStep(e: RobotEntity, dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const ang = m.retreatAngle ?? 0;
  const step = m.speed * dt;
  pos.x = clamp(pos.x + Math.cos(ang) * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + Math.sin(ang) * step, 0, worldPixelSize.height);
  e.heading = ang;
  m.state = RobotState.Moving;
  m.retreatTime = (m.retreatTime ?? 0) - dt;
}

/** The living base whose footprint contains `p`, or undefined. */
function baseContaining(ctx: GameContext, p: Vec2): BaseEntity | undefined {
  return bases(ctx.world).entities.find((b) => isAlive(b) && baseFootprintContains(b, p));
}

function moveEntity(e: RobotEntity, neighbours: readonly RobotEntity[], dt: number): void {
  const m = e.movement;
  const pos = e.position;
  const dest = m.destination;
  if (!dest) return;

  const dx = dest.x - pos.x;
  const dy = dest.y - pos.y;
  const dist = vecLength(dx, dy);
  e.heading = Math.atan2(dy, dx);

  const step = m.speed * dt;
  if (dist > gameConfig.robots.arrivalThreshold && step < dist) {
    // Step around a neighbour rather than into one. Only on a full step: the
    // arrival branch below has to be allowed to land exactly on its waypoint, or
    // the "he's arrived" tolerances the formation layer is built on start
    // disagreeing with where robots actually stop.
    const steered = steerAround(e, neighbours, e.heading, step);
    if (steered !== undefined) e.heading = steered;
    pos.x += Math.cos(e.heading) * step;
    pos.y += Math.sin(e.heading) * step;
    m.state = RobotState.Moving;
    return;
  }

  pos.x = dest.x;
  pos.y = dest.y;
  advanceWaypoint(m);
}
