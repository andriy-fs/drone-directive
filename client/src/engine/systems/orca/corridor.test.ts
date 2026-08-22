import { describe, expect, it } from 'vitest';
import { ChassisType, MapSize, Owner, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../config/gameConfig';
import type { RobotEntity } from '../../ecs/archetypes';
import { spawnRobot } from '../../ecs/factory';
import { resetIds } from '../../../utils/id';
import { isBlockedGrid, tileCentre, tileOf, type ObstacleGrid } from '../../obstacles';
import { distance } from '../../../utils/math';
import { makeCtx } from '../testkit';
import { setGoal, movementSystem } from '../movement';
import { separationSystem } from '../separation';

/**
 * Corridor throughput — the one thing the existing harnesses cannot see.
 *
 * `__stress.test.ts` plays whole matches on generated terrain, where the map
 * generator guarantees a 3-tile minimum corridor and the interesting geometry is
 * wherever the seed happened to put it. That measures *arrival*; it cannot isolate
 * *streaming*. This builds the geometry by hand — two open chambers joined by one
 * 3-tile (96 px) pass — and asks the question the local-avoidance layer exists to
 * answer: how long does a crowd take to get through, and do two counter-flowing
 * crowds form lanes or jam?
 *
 * No terrain generator, no formations, no tasks, no combat: `setGoal`, then
 * `movementSystem → separationSystem`, which is the whole decide/move/repair
 * pipeline the avoidance layer sits inside.
 *
 * Scenario B is the reason the file exists. `steerAround` is one-sided — each unit
 * deflects off the other's *current position*, and a head-on pair can pick the same
 * side — so it has no mechanism that produces lanes. A reciprocal solver does.
 * `laneSeparationPx` is that difference expressed as a number.
 */

const DT = 1 / 30;
const R = gameConfig.robots.radius;

// Two chambers joined by one 3-tile pass. Tile rows 19–21 are the corridor, so its
// centreline is the middle of row 20.
const WEST = { tx0: 1, tx1: 8 };
const PASS = { tx0: 9, tx1: 29, ty0: 19, ty1: 21 };
const EAST = { tx0: 30, tx1: 38 };
const CHAMBER = { ty0: 14, ty1: 26 };
const CENTRE_Y = tileCentre(0, 20).y;
const MID_X = tileCentre((PASS.tx0 + PASS.tx1) >> 1, 20).x;

/** Everything blocked except the two chambers and the pass between them. */
function corridorGrid(sealEast: boolean): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const grid: ObstacleGrid = [];
  for (let ty = 0; ty < height; ty++) {
    const row: boolean[] = [];
    for (let tx = 0; tx < width; tx++) {
      const inWest = tx >= WEST.tx0 && tx <= WEST.tx1 && ty >= CHAMBER.ty0 && ty <= CHAMBER.ty1;
      const inEast = !sealEast && tx >= EAST.tx0 && tx <= EAST.tx1 && ty >= CHAMBER.ty0 && ty <= CHAMBER.ty1;
      const inPass = tx >= PASS.tx0 && tx <= PASS.tx1 && ty >= PASS.ty0 && ty <= PASS.ty1;
      row.push(!(inWest || inEast || inPass));
    }
    grid.push(row);
  }
  return grid;
}

function makeCorridor(sealEast = false) {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(1);
  const grid = corridorGrid(sealEast);
  ctx.obstacles = grid;
  ctx.navObstacles = grid;
  ctx.sightBlockers = grid;
  return ctx;
}

interface Runner {
  e: RobotEntity;
  goal: { x: number; y: number };
  /** +1 driving east, -1 driving west — the lane measurement needs the sign. */
  dir: 1 | -1;
  arrivedAt: number;
  retreats: number;
  wasRetreating: boolean;
  ticksInRock: number;
}

interface Result {
  slowTicks: number;
  retreatTicks: number;
  ticksToClear: number;
  arrived: number;
  total: number;
  meanArrival: number;
  retreats: number;
  ticksInRock: number;
  maxOverlapPairs: number;
  throughput: number;
  laneSeparationPx: number;
}

/**
 * Runs one scenario to completion (or `maxTicks`) and reports it. `arrival` is a
 * radius test against the unit's own goal rather than "the path ran out": a unit
 * shoved off its last waypoint has still arrived, and scoring it otherwise would
 * measure the tolerance rather than the traffic.
 */
function play(runners: Runner[], ctx: ReturnType<typeof makeCorridor>, maxTicks: number): Result {
  const all = runners.map((r) => r.e);
  let maxOverlapPairs = 0;
  let ticksToClear = -1;
  // Lane separation is only meaningful where the walls actually bind, so it is
  // sampled inside the pass and only while both directions are present in it.
  let laneSum = 0;
  let laneSamples = 0;
  let crossings = 0;
  let slowTicks = 0;
  let retreatTicks = 0;
  const prevX = new Map<string, number>();

  for (let t = 0; t < maxTicks; t++) {
    for (const r of runners) {
      if (r.arrivedAt >= 0) continue;
      if (!r.e.movement.goal) setGoal(ctx, r.e, r.goal.x, r.goal.y);
    }
    for (const r of runners) prevX.set(r.e.id, r.e.position.x);

    movementSystem(ctx, DT);
    separationSystem(ctx);

    let overlaps = 0;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const d = distance(all[i].position.x, all[i].position.y, all[j].position.x, all[j].position.y);
        if (d < R * 2 - 1e-6) overlaps++;
      }
    }
    if (overlaps > maxOverlapPairs) maxOverlapPairs = overlaps;

    let eastInPass = 0;
    let westInPass = 0;
    let eastY = 0;
    let westY = 0;
    for (const r of runners) {
      const p = r.e.position;
      const tile = tileOf(p);
      if (isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) r.ticksInRock++;

      const retreating = (r.e.movement.retreatTime ?? 0) > 0;
      if (retreating && !r.wasRetreating) r.retreats++;
      r.wasRetreating = retreating;
      if (retreating) retreatTicks++;
      const vx = r.e.movement.velX;
      const vy = r.e.movement.velY;
      // The retreat's own threshold: < stuckEpsilon of net progress in a tick.
      if (r.arrivedAt < 0 && r.e.movement.goal && Math.sqrt(vx * vx + vy * vy) * DT < gameConfig.behavior.stuckEpsilon) {
        slowTicks++;
      }

      const before = prevX.get(r.e.id) ?? p.x;
      if ((before - MID_X) * (p.x - MID_X) < 0) crossings++;

      if (tile.tx >= PASS.tx0 && tile.tx <= PASS.tx1) {
        if (r.dir === 1) {
          eastInPass++;
          eastY += p.y - CENTRE_Y;
        } else {
          westInPass++;
          westY += p.y - CENTRE_Y;
        }
      }
      if (r.arrivedAt < 0 && distance(p.x, p.y, r.goal.x, r.goal.y) < R * 3) r.arrivedAt = t;
    }
    if (eastInPass > 0 && westInPass > 0) {
      laneSum += Math.abs(eastY / eastInPass - westY / westInPass);
      laneSamples++;
    }
    if (ticksToClear < 0 && runners.every((r) => r.arrivedAt >= 0)) ticksToClear = t;
  }

  const landed = runners.filter((r) => r.arrivedAt >= 0);
  return {
    slowTicks,
    retreatTicks,
    ticksToClear,
    arrived: landed.length,
    total: runners.length,
    meanArrival: landed.length ? landed.reduce((a, r) => a + r.arrivedAt, 0) / landed.length : 0,
    retreats: runners.reduce((a, r) => a + r.retreats, 0),
    ticksInRock: runners.reduce((a, r) => a + r.ticksInRock, 0),
    maxOverlapPairs,
    throughput: crossings,
    laneSeparationPx: laneSamples ? laneSum / laneSamples : 0,
  };
}

/** Packs `n` hulls into a chamber, column by column, at exactly the contact distance. */
function pack(ctx: ReturnType<typeof makeCorridor>, n: number, txStart: number, step: 1 | -1): RobotEntity[] {
  const out: RobotEntity[] = [];
  const rows = [18, 20, 22, 16, 24];
  for (let i = 0; i < n; i++) {
    const tx = txStart + step * ((i / rows.length) | 0);
    const ty = rows[i % rows.length];
    out.push(
      spawnRobot(ctx.world, Owner.Player, tileCentre(tx, ty), ChassisType.Tracks, WeaponType.Cannon) as RobotEntity,
    );
  }
  return out;
}

const runner = (e: RobotEntity, goal: { x: number; y: number }, dir: 1 | -1): Runner => ({
  e,
  goal,
  dir,
  arrivedAt: -1,
  retreats: 0,
  wasRetreating: false,
  ticksInRock: 0,
});

function report(name: string, r: Result): void {
  console.log(
    `${name.padEnd(22)} cleared ${r.ticksToClear >= 0 ? `${r.ticksToClear}t` : 'NEVER'} | arrived ${r.arrived}/${r.total}` +
      ` | mean ${r.meanArrival.toFixed(0)}t | crossings ${r.throughput} | retreats ${r.retreats}` +
      ` | ticksInRock ${r.ticksInRock} | maxOverlap ${r.maxOverlapPairs} | lanes ${r.laneSeparationPx.toFixed(1)}px` +
      ` | slow ${r.slowTicks} | retreatTicks ${r.retreatTicks}`,
  );
}

/**
 * Runs `scenario` once under each avoidance layer and prints both rows. The flag
 * is restored in a `finally` — leaking `enabled: true` into the rest of the file
 * would silently make every later baseline an ORCA measurement.
 */
function bothLayers(name: string, scenario: () => Result): { steer: Result; orca: Result } {
  const cfg = gameConfig.behavior.orca as { enabled: boolean };
  const was = cfg.enabled;
  try {
    cfg.enabled = false;
    const steer = scenario();
    report(`${name} [steer]`, steer);
    cfg.enabled = true;
    const orca = scenario();
    report(`${name} [orca] `, orca);
    return { steer, orca };
  } finally {
    cfg.enabled = was;
  }
}

describe('corridor — one 96 px pass between two chambers', () => {
  it('A: twelve hulls one way', () => {
    const { steer, orca } = bothLayers('A one-way', () => {
      const ctx = makeCorridor();
      const goal = tileCentre(EAST.tx0 + 4, 20);
      const runners = pack(ctx, 12, WEST.tx1, -1).map((e) => runner(e, goal, 1));
      return play(runners, ctx, 1800);
    });
    const r = steer;
    void orca;

    // Baseline with `steerAround`, recorded 2026-08-22: 10/12 arrived, never
    // cleared, 4 retreats, 0 ticks in rock, peak 9 overlapping pairs.
    // Guards, not aspirations — a local-avoidance change may not do worse.
    expect(r.arrived).toBeGreaterThanOrEqual(10);
    expect(r.ticksInRock).toBe(0);
  }, 120_000);

  it('B: six each way, counter-flow', () => {
    const { steer, orca } = bothLayers('B counter-flow', () => {
      const ctx = makeCorridor();
      const eastGoal = tileCentre(EAST.tx0 + 4, 20);
      const westGoal = tileCentre(WEST.tx0 + 2, 20);
      const runners = [
        ...pack(ctx, 6, WEST.tx1, -1).map((e) => runner(e, eastGoal, 1)),
        ...pack(ctx, 6, EAST.tx0, 1).map((e) => runner(e, westGoal, -1)),
      ];
      return play(runners, ctx, 1800);
    });
    const r = steer;
    void orca;

    // Baseline: cleared 471t, 12/12, 4 retreats, 0 ticks in rock, lanes 8.4 px.
    // Counter-flow beats one-way here, which is not the intuitive result: in A all
    // twelve press the same pass from one side, while in B each direction is only
    // six deep. Worth remembering before reading a corridor number as "harder".
    expect(r.arrived).toBe(r.total);
    expect(r.ticksInRock).toBe(0);
    expect(r.ticksToClear).toBeGreaterThan(0);
  }, 120_000);

  it('C: twelve hulls into a sealed pass', () => {
    const { steer, orca } = bothLayers('C dead-end', () => {
      const ctx = makeCorridor(true);
      // The goal is past the seal: nothing can reach it, and the point is that a
      // crowd told to try does not end up permanently welded into the dead end.
      const goal = tileCentre(EAST.tx0 + 4, 20);
      const runners = pack(ctx, 12, WEST.tx1, -1).map((e) => runner(e, goal, 1));
      return play(runners, ctx, 1800);
    });
    const r = steer;
    void orca;

    // Baseline: 0/12 (correct — the goal is unreachable), 6 retreats, peak 15
    // overlapping pairs, and **4683 robot-ticks spent standing inside rock**.
    //
    // That last number is a real pre-existing defect this harness is the first
    // thing to see: `separationSystem` resolves an overlap by pushing hulls apart
    // and clamps only to the world bounds, never to `navObstacles`, so a crowd
    // wedged into a dead end is squeezed straight into the walls. It does not show
    // up in `__stress.test.ts` because generated terrain has no dead ends this
    // tight. Recorded rather than asserted away; wall constraints should cut it.
    expect(r.ticksInRock).toBeLessThanOrEqual(4683);
    expect(r.arrived).toBe(0);
  }, 120_000);
});
