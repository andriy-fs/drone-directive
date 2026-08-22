import { describe, it } from 'vitest';
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

/** Temporary: parameter sweep for the ORCA horizons. Delete after stage 4. */

const DT = 1 / 30;
const R = gameConfig.robots.radius;
const WEST = { tx0: 1, tx1: 8 };
const PASS = { tx0: 9, tx1: 29, ty0: 19, ty1: 21 };
const EAST = { tx0: 30, tx1: 38 };
const CHAMBER = { ty0: 14, ty1: 26 };

function corridorGrid(): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const grid: ObstacleGrid = [];
  for (let ty = 0; ty < height; ty++) {
    const row: boolean[] = [];
    for (let tx = 0; tx < width; tx++) {
      const inWest = tx >= WEST.tx0 && tx <= WEST.tx1 && ty >= CHAMBER.ty0 && ty <= CHAMBER.ty1;
      const inEast = tx >= EAST.tx0 && tx <= EAST.tx1 && ty >= CHAMBER.ty0 && ty <= CHAMBER.ty1;
      const inPass = tx >= PASS.tx0 && tx <= PASS.tx1 && ty >= PASS.ty0 && ty <= PASS.ty1;
      row.push(!(inWest || inEast || inPass));
    }
    grid.push(row);
  }
  return grid;
}

function run(counter: boolean, variant: number): { arrived: number; mean: number; slow: number; rock: number; clear: number } {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(1);
  const grid = corridorGrid();
  ctx.obstacles = grid;
  ctx.navObstacles = grid;
  ctx.sightBlockers = grid;

  // Each variant is a different packing of the same crowd. One deterministic run
  // per configuration has no error bars, and the first sweep read as
  // non-monotonic in tau — which is the signature of noise, not a curve.
  const rowSets = [
    [18, 20, 22, 16, 24],
    [20, 18, 22, 24, 16],
    [19, 21, 17, 23, 20],
    [22, 18, 20, 24, 16],
    [17, 21, 19, 23, 25],
    [20, 22, 18, 16, 24],
    [21, 19, 23, 17, 20],
    [16, 24, 18, 22, 20],
  ];
  const rows = rowSets[variant % rowSets.length];
  const mk = (n: number, txStart: number, step: 1 | -1): RobotEntity[] => {
    const out: RobotEntity[] = [];
    for (let i = 0; i < n; i++) {
      const tx = txStart + step * ((i / rows.length) | 0);
      out.push(
        spawnRobot(ctx.world, Owner.Player, tileCentre(tx, rows[i % rows.length]), ChassisType.Tracks, WeaponType.Cannon) as RobotEntity,
      );
    }
    return out;
  };
  const eastGoal = tileCentre(EAST.tx0 + 4, 20);
  const westGoal = tileCentre(WEST.tx0 + 2, 20);
  const units: { e: RobotEntity; goal: { x: number; y: number }; at: number }[] = counter
    ? [
        ...mk(6, WEST.tx1, -1).map((e) => ({ e, goal: eastGoal, at: -1 })),
        ...mk(6, EAST.tx0, 1).map((e) => ({ e, goal: westGoal, at: -1 })),
      ]
    : mk(12, WEST.tx1, -1).map((e) => ({ e, goal: eastGoal, at: -1 }));

  let slow = 0;
  let rock = 0;
  let clear = -1;
  for (let t = 0; t < 1800; t++) {
    for (const u of units) if (u.at < 0 && !u.e.movement.goal) setGoal(ctx, u.e, u.goal.x, u.goal.y);
    movementSystem(ctx, DT);
    separationSystem(ctx);
    for (const u of units) {
      const p = u.e.position;
      const tile = tileOf(p);
      if (isBlockedGrid(grid, tile.tx, tile.ty)) rock++;
      const v = Math.sqrt(u.e.movement.velX ** 2 + u.e.movement.velY ** 2);
      if (u.at < 0 && u.e.movement.goal && v * DT < gameConfig.behavior.stuckEpsilon) slow++;
      if (u.at < 0 && distance(p.x, p.y, u.goal.x, u.goal.y) < R * 3) u.at = t;
    }
    if (clear < 0 && units.every((u) => u.at >= 0)) clear = t;
  }
  const landed = units.filter((u) => u.at >= 0);
  return {
    arrived: landed.length,
    mean: landed.length ? landed.reduce((a, u) => a + u.at, 0) / landed.length : 0,
    slow,
    rock,
    clear,
  };
}

const VARIANTS = 8;

/** Mean over every packing, so a table row is a signal rather than one sample. */
function arm(counter: boolean): { arrived: number; mean: number; slow: number; rock: number } {
  let arrived = 0;
  let mean = 0;
  let slow = 0;
  let rock = 0;
  let landedTotal = 0;
  for (let v = 0; v < VARIANTS; v++) {
    const r = run(counter, v);
    arrived += r.arrived;
    mean += r.mean * r.arrived;
    landedTotal += r.arrived;
    slow += r.slow;
    rock += r.rock;
  }
  return {
    arrived: arrived / VARIANTS,
    mean: landedTotal ? mean / landedTotal : 0,
    slow: slow / VARIANTS,
    rock: rock / VARIANTS,
  };
}

// Skipped by default: eight packings x fourteen arms is minutes, which does not
// belong in `npm test`. Drop the `.skip` to re-tune. Its finding is already
// recorded where it matters — the `timeHorizon` comment in `gameConfig.ts`.
describe.skip('orca horizon sweep', () => {
  it('sweeps timeHorizon x timeHorizonObst, averaged over packings', () => {
    const cfg = gameConfig.behavior.orca as { enabled: boolean; timeHorizon: number; timeHorizonObst: number };
    const was = { ...cfg };
    try {
      cfg.enabled = false;
      for (const counter of [false, true]) {
        const b = arm(counter);
        console.log(
          `${counter ? 'B' : 'A'} steer             arrived ${b.arrived.toFixed(2)}/12  mean ${b.mean.toFixed(0)}  slow ${b.slow.toFixed(0)}  rock ${b.rock.toFixed(0)}`,
        );
      }
      cfg.enabled = true;
      for (const tau of [0.3, 0.5, 1.0]) {
        for (const tauObst of [0.2, 0.35]) {
          cfg.timeHorizon = tau;
          cfg.timeHorizonObst = tauObst;
          for (const counter of [false, true]) {
            const r = arm(counter);
            console.log(
              `${counter ? 'B' : 'A'} tau ${tau.toFixed(2)} obst ${tauObst.toFixed(2)}  arrived ${r.arrived.toFixed(2)}/12  mean ${r.mean.toFixed(0)}  slow ${r.slow.toFixed(0)}  rock ${r.rock.toFixed(0)}`,
            );
          }
        }
      }
    } finally {
      Object.assign(cfg, was);
    }
  }, 1_800_000);
});
