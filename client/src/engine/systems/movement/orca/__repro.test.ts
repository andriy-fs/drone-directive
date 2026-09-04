import { describe, expect, it } from 'vitest';
import { ChassisType, MapSize, Owner, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../../config/gameConfig';
import type { RobotEntity } from '../../../ecs/archetypes';
import { spawnRobot } from '../../../ecs/factory';
import { resetIds } from '../../../../utils/id';
import { tileCentre, type ObstacleGrid } from '../../../obstacles';
import { distance } from '../../../../utils/math';
import { makeCtx } from '../../testkit';
import { setGoal, movementSystem } from '..';
import { separationSystem } from '../../separation';

/**
 * Temporary: reproduce the two play-test defects —
 *  1. a lone unit near an obstacle that rotates on the spot forever;
 *  2. a group that deadlocks in open ground.
 * See .docs/investigation/orca-spin-and-open-field-deadlock.md
 */

const DT = 1 / 30;

function openGrid(blocked: [number, number][]): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const grid: ObstacleGrid = [];
  for (let ty = 0; ty < height; ty++) grid.push(new Array<boolean>(width).fill(false));
  for (const [tx, ty] of blocked) grid[ty][tx] = true;
  return grid;
}

interface Scenario {
  name: string;
  blocked: [number, number][];
  units: { x: number; y: number; goalX: number; goalY: number }[];
  ticks?: number;
  reissueGoal?: boolean;
  /** Assert every unit reaches its goal (default). A/B hold unreachable goals. */
  expectArrive?: boolean;
}

type Variant = 'orca' | 'orca-i0' | 'steer';

/** Runs a scenario under each variant and prints spin/deadlock diagnostics. */
function runAll(s: Scenario): void {
  const cfg = gameConfig.behavior.orca as { enabled: boolean; prefInertia: number };
  const was = { enabled: cfg.enabled, prefInertia: cfg.prefInertia };
  try {
    for (const v of ['orca', 'orca-i0', 'steer'] as Variant[]) {
      cfg.enabled = v !== 'steer';
      cfg.prefInertia = v === 'orca-i0' ? 0 : was.prefInertia;
      run({ ...s, name: `${s.name} [${v}]` });
    }
  } finally {
    cfg.enabled = was.enabled;
    cfg.prefInertia = was.prefInertia;
  }
}

function run(s: Scenario): void {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(1);
  const grid = openGrid(s.blocked);
  ctx.obstacles = grid;
  ctx.navObstacles = grid;
  ctx.sightBlockers = grid;

  const pack: RobotEntity[] = s.units.map((u) =>
    spawnRobot(ctx.world, Owner.Player, { x: u.x, y: u.y }, ChassisType.Tracks, WeaponType.Cannon) as RobotEntity,
  );
  for (let i = 0; i < pack.length; i++) setGoal(ctx, pack[i], s.units[i].goalX, s.units[i].goalY);

  const ticks = s.ticks ?? 1200;
  // Per-unit stats over the LAST 300 ticks (the steady state the player sees).
  const WINDOW = 300;
  const spin = new Map<string, number>(); // cumulative |Δheading| rad in window
  const moved = new Map<string, number>(); // cumulative px in window
  const retreats = new Map<string, number>(); // retreat starts, whole run
  const wasRetreating = new Map<string, boolean>();
  const lastHeading = new Map(pack.map((u) => [u.id, u.heading]));
  const lastPos = new Map(pack.map((u) => [u.id, { x: u.position.x, y: u.position.y }]));
  const arrived = new Set<string>();

  for (let t = 0; t < ticks; t++) {
    for (let i = 0; i < pack.length; i++) {
      const u = pack[i];
      if (s.reissueGoal && !u.movement.goal) setGoal(ctx, u, s.units[i].goalX, s.units[i].goalY);
    }
    movementSystem(ctx, DT);
    separationSystem(ctx);

    for (let i = 0; i < pack.length; i++) {
      const u = pack[i];
      const r = (u.movement.retreatTime ?? 0) > 0;
      if (r && !wasRetreating.get(u.id)) retreats.set(u.id, (retreats.get(u.id) ?? 0) + 1);
      wasRetreating.set(u.id, r);

      if (t >= ticks - WINDOW) {
        const prevH = lastHeading.get(u.id) ?? u.heading;
        let dh = Math.abs(u.heading - prevH);
        if (dh > Math.PI) dh = 2 * Math.PI - dh;
        spin.set(u.id, (spin.get(u.id) ?? 0) + dh);
        const p = lastPos.get(u.id) ?? u.position;
        moved.set(u.id, (moved.get(u.id) ?? 0) + distance(u.position.x, u.position.y, p.x, p.y));
      }
      lastHeading.set(u.id, u.heading);
      lastPos.set(u.id, { x: u.position.x, y: u.position.y });
      if (distance(u.position.x, u.position.y, s.units[i].goalX, s.units[i].goalY) < gameConfig.grid.tilePx * 2) {
        arrived.add(u.id);
      }
    }
  }

  const lines = pack.map((u, i) => {
    const d = distance(u.position.x, u.position.y, s.units[i].goalX, s.units[i].goalY);
    return (
      `  ${u.id.padEnd(10)} arrived=${arrived.has(u.id) ? 'y' : 'N'} distLeft=${d.toFixed(0).padStart(4)}` +
      ` | window: spin=${(spin.get(u.id) ?? 0).toFixed(1).padStart(6)}rad moved=${(moved.get(u.id) ?? 0)
        .toFixed(0)
        .padStart(5)}px | retreats=${retreats.get(u.id) ?? 0}`
    );
  });
  console.log(`--- ${s.name} ---\n${lines.join('\n')}`);
  applyMapSize(MapSize.Medium);
  if (s.expectArrive !== false) {
    expect(arrived.size, `${s.name}: every unit arrives`).toBe(pack.length);
  }
}

function wall(tx: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let ty = from; ty <= to; ty++) out.push([tx, ty]);
  return out;
}

describe('repro: spin and open-field deadlock', () => {
  it('symptom 1 candidates: lone unit near rock', () => {
    const T = gameConfig.grid.tilePx;

    // A: goal walled in — unreachable. Unit stands next to a rock face.
    const box = [...wall(28, 18, 22), ...wall(32, 18, 22), [29, 18], [30, 18], [31, 18], [29, 22], [30, 22], [31, 22]] as [
      number,
      number,
    ][];
    const c = tileCentre(30, 20);
    runAll({
      name: 'A: unreachable goal, unit beside the box',
      blocked: box,
      expectArrive: false,
      units: [{ x: 27.5 * T, y: 20.5 * T, goalX: c.x, goalY: c.y }],
      reissueGoal: true,
    });

    // B: goal in the far chamber of a dead-end notch the unit starts inside.
    const notch = [...wall(19, 18, 22), ...wall(25, 18, 22), [20, 18], [21, 18], [22, 18], [23, 18], [24, 18], [20, 22], [21, 22], [22, 22], [23, 22], [24, 22]] as [number, number][];
    const g = tileCentre(34, 20);
    runAll({
      name: 'B: sealed notch, unreachable goal',
      blocked: notch,
      expectArrive: false,
      units: [{ x: tileCentre(21, 20).x, y: tileCentre(21, 20).y, goalX: g.x, goalY: g.y }],
      reissueGoal: true,
    });

    // C: goal inside rock (task layers do issue these) while unit hugs the face.
    const rock = [[24, 20], [25, 20], [24, 21], [25, 21]] as [number, number][];
    const inRock = tileCentre(24, 20);
    runAll({
      name: 'C: goal inside rock, unit at the face',
      blocked: rock,
      units: [{ x: 23.5 * T - 12, y: 20.5 * T, goalX: inRock.x, goalY: inRock.y }],
      reissueGoal: true,
    });
    // H: the field shape of symptom 1 — a unit parked 28 px off a rock face
    // leaves a lane A* routes through (tiles are free) but ORCA cannot: the mover
    // needs 23 px from the parked hull and 11 from the face, and 23 + 11 > 28.
    const face: [number, number][] = [];
    for (let tx = 16; tx <= 30; tx++) face.push([tx, 24]);
    const faceY = 24 * T; // top of the rock row
    const parkX = 23.5 * T;
    runAll({
      name: 'H: pocket between rock and a parked unit',
      blocked: face,
      units: [
        { x: parkX, y: faceY - 28, goalX: parkX, goalY: faceY - 28 },
        { x: parkX - 200, y: faceY - 15, goalX: parkX + 250, goalY: faceY - 15 },
      ],
      reissueGoal: true,
    });
  }, 60_000);

  it('symptom 2 candidates: group in the open', () => {
    const T = gameConfig.grid.tilePx;
    const cx = 25.5 * T;
    const cy = 25.5 * T;

    // D: antipodal circle swap — the classic ORCA symmetric trap.
    for (const n of [4, 8, 12]) {
      const R = 150;
      const units = [];
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        units.push({
          x: cx + Math.cos(a) * R,
          y: cy + Math.sin(a) * R,
          goalX: cx - Math.cos(a) * R,
          goalY: cy - Math.sin(a) * R,
        });
      }
      runAll({ name: `D: antipodal swap n=${n}`, blocked: [], units, reissueGoal: true });
    }

    // E: movers threading a lattice of passive holders (formation hold: no goal).
    {
      const units = [];
      // 3x3 lattice of holders, 40 px apart (goal = own position → arrives instantly, then holds)
      for (let gy = -1; gy <= 1; gy++)
        for (let gx = -1; gx <= 1; gx++) {
          const x = cx + gx * 40;
          const y = cy + gy * 40;
          units.push({ x, y, goalX: x, goalY: y });
        }
      // 4 movers ordered straight through the lattice
      for (let i = 0; i < 4; i++) {
        units.push({ x: cx - 200, y: cy - 45 + i * 30, goalX: cx + 200, goalY: cy - 45 + i * 30 });
      }
      runAll({ name: 'E: movers through passive holders', blocked: [], units, reissueGoal: true });
    }

    // F: two packs head-on in the open.
    {
      const units = [];
      for (let i = 0; i < 6; i++) {
        units.push({ x: cx - 180, y: cy - 62.5 + i * 25, goalX: cx + 180, goalY: cy - 62.5 + i * 25 });
        units.push({ x: cx + 180, y: cy - 62.5 + i * 25, goalX: cx - 180, goalY: cy - 62.5 + i * 25 });
      }
      runAll({ name: 'F: two packs head-on', blocked: [], units, reissueGoal: true });
    }

    // G: a tight blob all ordered to the same point (post-fight regroup).
    {
      const units = [];
      for (let i = 0; i < 10; i++) {
        units.push({ x: cx - 100 + (i % 5) * 25, y: cy - 12 + Math.floor(i / 5) * 25, goalX: cx + 300, goalY: cy });
      }
      runAll({ name: 'G: blob to one point', blocked: [], units, reissueGoal: true });
    }
  }, 60_000);
});
