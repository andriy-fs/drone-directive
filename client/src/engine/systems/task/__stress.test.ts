import { describe, it, vi } from 'vitest';
import { ChassisType, FormationType, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../config/gameConfig';
import type { BaseEntity, RobotEntity } from '../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import { refreshNavObstacles } from '../../navGrid';
import { isBlockedGrid, tileCentre, tileOf } from '../../obstacles';
import { resetIds } from '../../../utils/id';
import { makeCtx } from '../testkit';
import { commandsSystem } from '../commands';
import { movementSystem } from '../movement';
import { separationSystem } from '../separation';
import { baseFootprintContains } from '../targeting';
import { findPath } from '../../pathfinding';
import { visionSystem } from '../vision';
import { findPathViaField, fieldStats, resetFieldCache, resetFieldStats } from './__flowField';
import { taskSystem } from './index';

/**
 * Investigation harness — NOT a test. Nothing is asserted; it plays the same
 * seeded matches under three routing modes and prints what happened, so
 * `.docs/investigation/flow-field-vs-astar-at-density.md` can be answered with
 * numbers. Delete with that investigation.
 *
 * The one variable is where a route comes from. Everything else — map, seeds,
 * spawn order, orders, system pipeline, path smoothing, separation, the anti-jam
 * — is byte-identical across modes, so a difference in the table is a difference
 * in routing and nothing else.
 *
 *   astar   the shipping `findPath`, per unit and per formation frame
 *   field   every route descends a Dijkstra field cached per goal tile
 *   hybrid  the frame's march route comes off a field, personal goals stay on A*
 *
 * Combat is deliberately absent from the pipeline: nobody dies, so a unit that
 * jams stays jammed and can be measured, instead of being deleted by the base
 * turret halfway through the observation. `visionSystem` **is** in it, and has to
 * be: `engageOutcome` only stops a hull once the target is *visible*, and a base
 * is read off `visibleBaseIds` rather than `knownBaseIds` — without it nobody
 * could ever stop driving and the crowd at the objective would be an artefact of
 * the harness rather than a finding.
 */

type Mode = 'astar' | 'field' | 'hybrid';

const H = vi.hoisted(() => ({ mode: 'astar' as Mode, frameCalls: 0, unitCalls: 0 }));

/**
 * Both routing call sites live behind this one module, so mocking it swaps the
 * routing for the whole engine without a single production edit.
 *
 * `hybrid` has to tell the two callers apart, and the only thing that
 * distinguishes them at the call is who is on the stack: `routeFor` in
 * `formation.ts` builds the frame's march route, `setGoal` in `movement.ts`
 * builds a unit's own. It is the *immediate* caller that decides — a whole-stack
 * search would misread every unit goal, because `formation.ts` is what calls
 * `setGoal` for a slotted robot in the first place. The two counters below exist
 * to prove the split landed where it was meant to.
 */
vi.mock('../../pathfinding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pathfinding')>();
  const field = await import('./__flowField');
  return {
    ...actual,
    findPath(grid: Parameters<typeof actual.findPath>[0], from: Parameters<typeof actual.findPath>[1], to: Parameters<typeof actual.findPath>[2]) {
      if (H.mode === 'astar') return actual.findPath(grid, from, to);
      if (H.mode === 'field') return field.findPathViaField(grid, from, to);
      const caller = (new Error().stack ?? '').split('\n')[2] ?? '';
      if (caller.includes('formation.ts')) {
        H.frameCalls++;
        return field.findPathViaField(grid, from, to);
      }
      H.unitCalls++;
      return actual.findPath(grid, from, to);
    },
  };
});

const DT = 1 / 30;
const TICKS = 2700; // 90 s
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MODES: Mode[] = ['astar', 'field', 'hybrid'];
const SHAPE: FormationType | null = FormationType.Box;

/**
 * The three unit counts the brief asks for. `production.maxRobots` is 12 a side,
 * so 50 is above anything a real match can reach and the curve is the point.
 * Every group's mix fills all three `FORMATION_RANK` ranks.
 */
const LOADOUTS: Record<number, { groups: number; weapons: WeaponType[] }> = {
  12: { groups: 2, weapons: [WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar] },
  24: { groups: 4, weapons: [WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar] },
  50: {
    groups: 5,
    weapons: [
      WeaponType.Cannon,
      WeaponType.Cannon,
      WeaponType.Cannon,
      WeaponType.Cannon,
      WeaponType.Cannon,
      WeaponType.Cannon,
      WeaponType.Missiles,
      WeaponType.Missiles,
      WeaponType.Ew,
      WeaponType.Radar,
    ],
  },
};

/** Why a robot was standing still, judged at the worst moment of its longest stall. */
type Cause = 'at-objective' | 'in-footprint' | 'crowd' | 'terrain' | 'no-route' | 'unexplained';

interface Stall {
  id: string;
  group: number;
  ticks: number;
  cause: Cause;
  tx: number;
  ty: number;
  toObjective: number;
  nearest: number;
}

function playMatch(seed: number, shape: FormationType | null, total: number) {
  const { groups: GROUPS, weapons: WEAPONS } = LOADOUTS[total];
  const PER_GROUP = WEAPONS.length;
  // Exactly what `startMatch` does, and for the same reason: entity ids come off
  // a module-global counter, and lockstep requires a match to start numbering
  // from scratch. Without it the second play of a seed spawns `robot_51` where
  // the first spawned `robot_1`, and any tie-break that touches an id makes two
  // identical matches diverge — which reads as engine non-determinism when it is
  // only the harness forgetting to reset.
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(seed);

  let home: BaseEntity | undefined;
  let foe: BaseEntity | undefined;
  for (const p of gameConfig.bases.placements) {
    const base = spawnBase(ctx.world, p.owner, p.tx, p.ty);
    if (p.owner === Owner.Player) home = base;
    else foe = base;
  }
  if (!home || !foe) throw new Error('both placements must spawn a base');
  refreshNavObstacles(ctx);
  ctx.intel[Owner.Player].knownBaseIds.add(foe.id);

  // Hulls on the free ground nearest the base, taken in flood-fill order so the
  // crowd is compact and every one of them starts somewhere it could have driven to.
  const start = tileOf(home.position);
  const spots: { tx: number; ty: number }[] = [];
  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const queue = [start];
  while (queue.length && spots.length < GROUPS * PER_GROUP) {
    const cur = queue.shift();
    if (!cur) break;
    if (!isBlockedGrid(ctx.navObstacles, cur.tx, cur.ty)) spots.push(cur);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { tx: cur.tx + dx, ty: cur.ty + dy };
      const k = `${next.tx},${next.ty}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }

  const groups: RobotEntity[][] = [];
  for (let g = 0; g < GROUPS; g++) {
    const members: RobotEntity[] = [];
    for (let i = 0; i < PER_GROUP; i++) {
      const spot = spots[g * PER_GROUP + i];
      const e = spawnRobot(
        ctx.world,
        Owner.Player,
        tileCentre(spot.tx, spot.ty),
        ChassisType.Tracks,
        WEAPONS[i],
      ) as RobotEntity;
      members.push(e);
    }
    groups.push(members);
    if (shape) ctx.commands.push({ kind: 'SetFormation', robotIds: members.map((e) => e.id), formation: shape });
    for (const e of members) ctx.commands.push({ kind: 'AssignTask', robotId: e.id, task: TaskType.AttackBase });
  }
  const all = groups.flat();
  const slotOf = new Map(all.map((e, i) => [e.id, i]));
  const groupOf = new Map(all.map((e, i) => [e.id, (i / PER_GROUP) | 0]));

  const centre = (members: RobotEntity[]) => ({
    x: members.reduce((a, e) => a + e.position.x, 0) / members.length,
    y: members.reduce((a, e) => a + e.position.y, 0) / members.length,
  });
  const toFoe = (p: { x: number; y: number }) => Math.hypot(foe.position.x - p.x, foe.position.y - p.y);

  const nearestNeighbour = (self: RobotEntity) => {
    let best = Infinity;
    for (const other of all) {
      if (other === self) continue;
      const d = Math.hypot(other.position.x - self.position.x, other.position.y - self.position.y);
      if (d < best) best = d;
    }
    return best;
  };

  /** Rock within a hull's width of where it stands. */
  const againstRock = (e: RobotEntity) => {
    const r: number = gameConfig.robots.radius;
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
      [r, r],
      [r, -r],
      [-r, r],
      [-r, -r],
    ]) {
      const t = tileOf({ x: e.position.x + dx, y: e.position.y + dy });
      if (isBlockedGrid(ctx.navObstacles, t.tx, t.ty)) return true;
    }
    return false;
  };

  const classify = (e: RobotEntity): Cause => {
    if (toFoe(e.position) < 300) return 'at-objective';
    const inBase = [home, foe].some((b) => b && baseFootprintContains(b, e.position));
    if (inBase) return 'in-footprint';
    if (e.movement.goal && (e.movement.path?.length ?? 0) === 0) return 'no-route';
    if (nearestNeighbour(e) < gameConfig.robots.radius * 2 + 2) return 'crowd';
    if (againstRock(e)) return 'terrain';
    return 'unexplained';
  };

  // Per-robot stall streaks, and per-group progress.
  const last = new Map<string, { x: number; y: number }>();
  const streak = new Map<string, number>();
  const worst = new Map<string, Stall>();
  const groupWindow: number[][] = groups.map(() => []);
  const groupStall = groups.map(() => 0);
  const groupValve = groups.map(() => 0);
  const groupValveEnRoute = groups.map(() => 0);
  const arrivedAt = groups.map(() => -1);
  const wasReleased = groups.map(() => false);
  const releasedTicks = groups.map(() => 0);
  const releasedTicksEnRoute = groups.map(() => 0);
  // How long the route actually is, so a slow run can be told from a stuck one.
  const routePx = (() => {
    const path = findPath(ctx.navObstacles, home.position, foe.position);
    let len = 0;
    let prev = home.position;
    for (const p of path) {
      len += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
    return len;
  })();
  const straightPx = Math.hypot(foe.position.x - home.position.x, foe.position.y - home.position.y);

  // How far each hull actually had to drive, measured from where it spawned to
  // the arrival ring. Always taken with A*, in every mode: this is the *distance
  // the ground demands*, the denominator both routings are judged against, and
  // scoring a field against its own longer route would hide exactly the
  // regression the comparison is looking for.
  const demandPx = new Map<string, number>();
  {
    const prevMode = H.mode;
    H.mode = 'astar';
    for (const e of all) {
      let len = 0;
      let prev: { x: number; y: number } = e.position;
      for (const p of findPath(ctx.navObstacles, e.position, foe.position)) {
        len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      demandPx.set(e.id, Math.max(0, len - 250)); // arrival is a 250 px ring, not the centre
    }
    H.mode = prevMode;
  }
  const unitArrivedAt = new Map<string, number>();
  const footprintStay = new Map<string, number>();
  let worstFootprintStay = 0;
  let worstStayWhere = '';
  let worstStayEnded = 0;
  let homeStayTicks = 0;
  let foeStayTicks = 0;
  let stalledTicks = 0;
  let stalledEnRoute = 0;
  let enRouteRobotTicks = 0;
  let peakStalled = 0;

  for (let t = 0; t < TICKS; t++) {
    commandsSystem(ctx);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    movementSystem(ctx, DT);
    separationSystem(ctx);

    let stalledNow = 0;
    for (const e of all) {
      const prev = last.get(e.id);
      const moved = prev ? Math.hypot(e.position.x - prev.x, e.position.y - prev.y) : Infinity;
      last.set(e.id, { x: e.position.x, y: e.position.y });
      // "Wants to be somewhere and is not getting there" — the same test the
      // anti-jam uses, sampled over a whole tick.
      const stuck = e.movement.goal !== undefined && moved < gameConfig.behavior.stuckEpsilon;
      const n = stuck ? (streak.get(e.id) ?? 0) + 1 : 0;
      streak.set(e.id, n);
      if (stuck) stalledNow++;
      // Split by phase, per *unit*: a hull shoving for a spot around a base it has
      // reached is a crowd, not a routing fault. Per unit rather than per group so
      // the same measure is fair with no formation at all, where a "group" is only
      // this harness's bookkeeping and its centroid may never converge.
      if (!unitArrivedAt.has(e.id) && toFoe(e.position) < 250) unitArrivedAt.set(e.id, t);
      if (!unitArrivedAt.has(e.id)) {
        enRouteRobotTicks++;
        if (stuck) stalledEnRoute++;
      }
      const inHome = baseFootprintContains(home, e.position);
      const inFoe = baseFootprintContains(foe, e.position);
      if (inHome) homeStayTicks++;
      if (inFoe) foeStayTicks++;
      const stay = inHome || inFoe ? (footprintStay.get(e.id) ?? 0) + 1 : 0;
      footprintStay.set(e.id, stay);
      if (stay > worstFootprintStay) {
        worstFootprintStay = stay;
        worstStayWhere = inHome ? 'own' : 'enemy';
        worstStayEnded = t;
      }
      if (n > (worst.get(e.id)?.ticks ?? 0)) {
        const tile = tileOf(e.position);
        worst.set(e.id, {
          id: e.id,
          group: groupOf.get(e.id) ?? -1,
          ticks: n,
          cause: classify(e),
          tx: tile.tx,
          ty: tile.ty,
          toObjective: toFoe(e.position),
          nearest: nearestNeighbour(e),
        });
      }
    }
    stalledTicks += stalledNow;
    if (stalledNow > peakStalled) peakStalled = stalledNow;

    groups.forEach((members, g) => {
      const reach = toFoe(centre(members));
      if (arrivedAt[g] < 0 && reach < 300) arrivedAt[g] = t;
      const w = groupWindow[g];
      w.push(reach);
      if (w.length > 300) w.shift();
      if (w.length === 300 && w[0] - w[299] < 32 && reach > 300) groupStall[g]++;
      else if (w.length === 300) groupStall[g] = 0;

      const released = members.some((e) => (e.script.blackboard.formationProgress?.released ?? 0) > 0);
      if (released) {
        releasedTicks[g]++;
        if (arrivedAt[g] < 0) releasedTicksEnRoute[g]++;
      }
      if (released && !wasReleased[g]) {
        groupValve[g]++;
        if (arrivedAt[g] < 0) groupValveEnRoute[g]++;
      }
      wasReleased[g] = released;
    });
  }

  // What the crowd at the objective actually looks like on the last tick.
  const goalTiles = new Set<string>();
  let withGoal = 0;
  let inFoeFootprint = 0;
  let touching = 0;
  let routeless = 0;
  for (const e of all) {
    if (e.movement.goal) {
      withGoal++;
      const t = tileOf(e.movement.goal);
      goalTiles.add(`${t.tx},${t.ty}`);
      if ((e.movement.path?.length ?? 0) === 0) routeless++;
    }
    if (baseFootprintContains(foe, e.position)) inFoeFootprint++;
    if (nearestNeighbour(e) < gameConfig.robots.radius * 2) touching++;
  }

  // Which spawn slots got there, so "stuck where the other mode got through" is a
  // set difference rather than an impression. Spawn order is seed-determined and
  // identical across modes, so slot i is the same hull in every run.
  const arrivedSlots = new Set<number>();
  for (const id of unitArrivedAt.keys()) {
    const s = slotOf.get(id);
    if (s !== undefined) arrivedSlots.add(s);
  }

  return {
    endstate: { withGoal, goalTiles: goalTiles.size, inFoeFootprint, touching, routeless },
    stalls: [...worst.values()].filter((s) => s.ticks > 0),
    groups: groups.map((members, g) => ({
      g,
      reach: toFoe(centre(members)),
      arrived: arrivedAt[g] >= 0,
      arrivedAt: arrivedAt[g],
      valve: groupValve[g],
      valveEnRoute: groupValveEnRoute[g],
      releasedShare: arrivedAt[g] > 0 ? releasedTicksEnRoute[g] / arrivedAt[g] : 0,
    })),
    arrivedSlots,
    unitsArrived: unitArrivedAt.size,
    unitArrivals: [...unitArrivedAt.values()],
    // One drag figure per arrived hull: the ground it had to cover over the
    // ground its chassis could have covered in the time it took.
    drags: [...unitArrivedAt.entries()]
      .filter(([, tick]) => tick > 0)
      .map(([id, tick]) => (demandPx.get(id) ?? 0) / (tick * DT * all[0].movement.speed)),
    finalHash: all.map((e) => `${e.position.x.toFixed(6)},${e.position.y.toFixed(6)}`).join('|'),
    units: all.length,
    speed: all[0].movement.speed,
    routePx,
    straightPx,
    worstFootprintStay,
    worstStayWhere,
    worstStayEnded,
    homeStayTicks,
    foeStayTicks,
    stalledTicks,
    stalledEnRoute,
    enRouteRobotTicks,
    peakStalled,
    robotTicks: all.length * TICKS,
  };
}

interface Aggregate {
  mode: Mode;
  total: number;
  unitsArrived: number;
  unitsTotal: number;
  stalledEnRoutePct: number;
  stalledAllPct: number;
  meanArrival: number;
  slowestArrival: number;
  dragPct: number;
  valvesEnRoute: number;
  valvesTotal: number;
  worstStay: number;
  foeStayPerArrived: number;
  causes: Map<Cause, { count: number; worst: number }>;
  arrivedBySeed: Map<number, Set<number>>;
  fields: ReturnType<typeof fieldStats>;
  routeCalls: { frame: number; unit: number };
  hashes: Map<number, string>;
  meanRoutePx: number;
}

function runSweep(mode: Mode, total: number): Aggregate {
  H.mode = mode;
  H.frameCalls = 0;
  H.unitCalls = 0;
  resetFieldStats();

  const causes = new Map<Cause, { count: number; worst: number }>();
  const arrivedBySeed = new Map<number, Set<number>>();
  let stalledTicks = 0;
  let robotTicks = 0;
  let stalledEnRoute = 0;
  let enRouteRobotTicks = 0;
  let worstStay = 0;
  let unitsArrived = 0;
  let unitsTotal = 0;
  let unitArrivals: number[] = [];
  let foeStayTicks = 0;
  let valves = 0;
  let valvesEnRoute = 0;
  const drags: number[] = [];
  const hashes = new Map<number, string>();
  const routes: number[] = [];

  for (const seed of SEEDS) {
    resetFieldCache(); // a new match is a new grid; nothing carries over
    const r = playMatch(seed, SHAPE, total);
    stalledTicks += r.stalledTicks;
    robotTicks += r.robotTicks;
    stalledEnRoute += r.stalledEnRoute;
    enRouteRobotTicks += r.enRouteRobotTicks;
    worstStay = Math.max(worstStay, r.worstFootprintStay);
    unitsArrived += r.unitsArrived;
    unitsTotal += r.units;
    unitArrivals = unitArrivals.concat(r.unitArrivals);
    foeStayTicks += r.foeStayTicks;
    valves += r.groups.reduce((a, g) => a + g.valve, 0);
    valvesEnRoute += r.groups.reduce((a, g) => a + g.valveEnRoute, 0);
    arrivedBySeed.set(seed, r.arrivedSlots);
    hashes.set(seed, r.finalHash);
    routes.push(r.routePx);

    // Congestion drag: the share of its chassis speed a hull actually converted
    // into progress along the route the ground demanded of it.
    for (const d of r.drags) drags.push(d);

    for (const s of r.stalls.filter((x) => x.ticks >= 30)) {
      const cur = causes.get(s.cause) ?? { count: 0, worst: 0 };
      causes.set(s.cause, { count: cur.count + 1, worst: Math.max(cur.worst, s.ticks) });
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    mode,
    total,
    unitsArrived,
    unitsTotal,
    stalledEnRoutePct: (stalledEnRoute / Math.max(1, enRouteRobotTicks)) * 100,
    stalledAllPct: (stalledTicks / robotTicks) * 100,
    meanArrival: mean(unitArrivals),
    slowestArrival: unitArrivals.length ? Math.max(...unitArrivals) : 0,
    dragPct: mean(drags) * 100,
    valvesEnRoute,
    valvesTotal: valves,
    worstStay,
    foeStayPerArrived: foeStayTicks / Math.max(1, unitsArrived),
    causes,
    arrivedBySeed,
    fields: { ...fieldStats() },
    routeCalls: { frame: H.frameCalls, unit: H.unitCalls },
    hashes,
    meanRoutePx: mean(routes),
  };
}

describe('investigation — flow field against A*, at 12 / 24 / 50 units', () => {
  it('reports both routings on identical seeded matches', () => {
    // Before any of the play-through numbers mean anything: how different is a
    // field route from an A* route in the first place? Both minimise the same
    // octile cost over the same grid, so if they agree, every table below is
    // measuring tie-breaks and jostle rather than navigation — and that is the
    // single most explanatory number in this document.
    {
      let pairs = 0;
      let sameLength = 0;
      let fieldLonger = 0;
      let astarLonger = 0;
      let ratioSum = 0;
      let worstRatio = 1;
      for (const seed of SEEDS) {
        resetIds();
        applyMapSize(MapSize.Small);
        resetFieldCache();
        const ctx = makeCtx(seed);
        let foe: BaseEntity | undefined;
        for (const p of gameConfig.bases.placements) {
          const b = spawnBase(ctx.world, p.owner, p.tx, p.ty);
          if (p.owner !== Owner.Player) foe = b;
        }
        if (!foe) continue;
        refreshNavObstacles(ctx);
        const len = (pts: readonly { x: number; y: number }[], from: { x: number; y: number }) => {
          let acc = 0;
          let prev = from;
          for (const q of pts) {
            acc += Math.hypot(q.x - prev.x, q.y - prev.y);
            prev = q;
          }
          return acc;
        };
        // Every free tile on the map, so the sample is the whole ground rather
        // than the handful of places units happen to stand.
        for (let ty = 0; ty < gameConfig.grid.height; ty += 3) {
          for (let tx = 0; tx < gameConfig.grid.width; tx += 3) {
            if (isBlockedGrid(ctx.navObstacles, tx, ty)) continue;
            const from = tileCentre(tx, ty);
            H.mode = 'astar';
            const a = len(findPath(ctx.navObstacles, from, foe.position), from);
            const f = len(findPathViaField(ctx.navObstacles, from, foe.position), from);
            if (a === 0 || f === 0) continue;
            pairs++;
            ratioSum += f / a;
            worstRatio = Math.max(worstRatio, f / a);
            if (Math.abs(f - a) < 0.5) sameLength++;
            else if (f > a) fieldLonger++;
            else astarLonger++;
          }
        }
      }
      console.log('\n=== are they even different routes? (raw, unsmoothed, every 3rd free tile to the enemy base) ===');
      console.log(
        `${pairs} route pairs | identical length ${((sameLength / pairs) * 100).toFixed(1)}% | ` +
          `field longer ${fieldLonger}, A* longer ${astarLonger} | ` +
          `mean field/A* length ${(ratioSum / pairs).toFixed(4)}, worst ${worstRatio.toFixed(4)}`,
      );
    }

    const results: Aggregate[] = [];
    for (const total of [12, 24, 50]) {
      for (const mode of MODES) results.push(runSweep(mode, total));
    }

    const pad = (s: string | number, n: number) => String(s).padStart(n);
    const row = (a: Aggregate) =>
      `${a.mode.padEnd(7)}${pad(a.total, 4)}${pad(`${a.unitsArrived}/${a.unitsTotal}`, 10)}` +
      `${pad(a.stalledEnRoutePct.toFixed(2) + '%', 9)}${pad(a.stalledAllPct.toFixed(2) + '%', 9)}` +
      `${pad(a.meanArrival.toFixed(0), 8)}${pad(a.slowestArrival, 9)}${pad(a.dragPct.toFixed(0) + '%', 7)}` +
      `${pad(a.valvesEnRoute, 7)}${pad(a.valvesTotal, 7)}${pad(a.worstStay, 8)}${pad(a.foeStayPerArrived.toFixed(0), 9)}`;

    console.log(`\n=== ${SEEDS.length} seeds x ${TICKS} ticks, small map, shape: ${SHAPE ?? 'none'} ===`);
    console.log(
      'mode    n   arrived  enRoute      all  meanArr  slowest   drag  valveR valveT worstFP  foeStay',
    );
    for (const a of results) console.log(row(a));

    console.log('\n=== stall classification (stalls >= 1 s, at the unit\'s worst moment) ===');
    for (const a of results) {
      const listed = [...a.causes.entries()].sort((x, y) => y[1].count - x[1].count);
      const body = listed.map(([c, v]) => `${c} ${v.count} (worst ${v.worst}t)`).join(', ') || 'none';
      console.log(`${a.mode.padEnd(7)}${pad(a.total, 4)}  ${body}`);
    }

    console.log('\n=== what the field cost, and how much sharing it actually got ===');
    for (const a of results) {
      if (a.mode === 'astar') continue;
      const f = a.fields;
      console.log(
        `${a.mode.padEnd(7)}${pad(a.total, 4)}  ${f.builds} fields built over ${SEEDS.length} runs, ` +
          `${f.hits} cache hits, ${f.cellsSettled} tiles settled, ${f.cellsFlooded} relaxations, ` +
          `${f.descentSteps} descent steps` +
          (a.mode === 'hybrid' ? ` | routed: ${a.routeCalls.frame} frame / ${a.routeCalls.unit} unit` : ''),
      );
    }

    console.log('\n=== regressions: units one mode landed and another did not, per seed ===');
    for (const total of [12, 24, 50]) {
      const base = results.find((r) => r.mode === 'astar' && r.total === total);
      if (!base) continue;
      for (const mode of MODES) {
        if (mode === 'astar') continue;
        const other = results.find((r) => r.mode === mode && r.total === total);
        if (!other) continue;
        let lost = 0;
        let won = 0;
        const lostSeeds: number[] = [];
        for (const seed of SEEDS) {
          const a = base.arrivedBySeed.get(seed) ?? new Set<number>();
          const b = other.arrivedBySeed.get(seed) ?? new Set<number>();
          const l = [...a].filter((s) => !b.has(s)).length;
          const w = [...b].filter((s) => !a.has(s)).length;
          lost += l;
          won += w;
          if (l > 0) lostSeeds.push(seed);
        }
        console.log(
          `${mode.padEnd(7)}${pad(total, 4)}  lost ${lost} that A* landed${lostSeeds.length ? ` (seeds ${lostSeeds.join(',')})` : ''}, gained ${won} A* did not`,
        );
      }
    }

    console.log('\n=== determinism: the same seeded match played twice, per mode ===');
    for (const mode of MODES) {
      const first = runSweep(mode, 12);
      const second = runSweep(mode, 12);
      let same = 0;
      for (const seed of SEEDS) if (first.hashes.get(seed) === second.hashes.get(seed)) same++;
      console.log(`${mode.padEnd(7)} ${same}/${SEEDS.length} seeds reproduced every hull position exactly`);
    }

    console.log(
      `\nmean base-to-base A* route: ${(results.find((r) => r.mode === 'astar')?.meanRoutePx ?? 0).toFixed(0)} px`,
    );

    applyMapSize(MapSize.Medium);
  }, 1_800_000);
});
