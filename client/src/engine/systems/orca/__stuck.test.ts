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

/** Temporary: reproduce "a unit gets stuck beside rock" in isolation. */

const DT = 1 / 30;

function openGrid(blocked: [number, number][]): ObstacleGrid {
  const { width, height } = gameConfig.grid;
  const grid: ObstacleGrid = [];
  for (let ty = 0; ty < height; ty++) grid.push(new Array<boolean>(width).fill(false));
  for (const [tx, ty] of blocked) grid[ty][tx] = true;
  // The world edge is blocked by `isBlockedGrid` anyway; nothing else is.
  return grid;
}

function drive(name: string, blocked: [number, number][], fromTx: number, toTx: number, ty: number, crowd = 1): void {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(1);
  const grid = openGrid(blocked);
  ctx.obstacles = grid;
  ctx.navObstacles = grid;
  ctx.sightBlockers = grid;

  // A pack abreast, so a hull can be pressed toward rock by its own side.
  const rows = [0, -1, 1, -2, 2, -3, 3, 0, -1, 1];
  const cols = [0, 0, 0, 0, 0, 0, 0, -1, -1, -1];
  const pack: RobotEntity[] = [];
  for (let i = 0; i < crowd; i++) {
    pack.push(
      spawnRobot(
        ctx.world,
        Owner.Player,
        tileCentre(fromTx + cols[i % cols.length], ty + rows[i % rows.length]),
        ChassisType.Tracks,
        WeaponType.Cannon,
      ) as RobotEntity,
    );
  }
  const e = pack[0];
  const goal = tileCentre(toTx, ty);

  // Arrival is **per unit**, against a radius that does not depend on how tightly
  // the layer packs a crowd. The first version asked for all eight hulls within
  // 66 px of one point — which ORCA, holding them 23 px apart, physically cannot
  // satisfy — so it scored a spread-out arrival as "stuck". Same trap the
  // flow-field brief records about group centroids, wearing a different hat.
  const ARRIVE = gameConfig.grid.tilePx * 3;
  const arrivedAtPer = new Map<string, number>();
  let stalled = 0;
  let worstStreak = 0;
  const streaks = new Map<string, number>();
  let inRock = 0;
  let retreats = 0;
  const wasRetreatingPer = new Map<string, boolean>();
  const lastPer = new Map(pack.map((u) => [u.id, { x: u.position.x, y: u.position.y }]));
  void e;

  for (let t = 0; t < 900 && arrivedAtPer.size < pack.length; t++) {
    for (const u of pack) if (!u.movement.goal) setGoal(ctx, u, goal.x, goal.y);
    movementSystem(ctx, DT);
    separationSystem(ctx);

    for (const u of pack) {
      const prev = lastPer.get(u.id) ?? { x: u.position.x, y: u.position.y };
      const moved = distance(u.position.x, u.position.y, prev.x, prev.y);
      lastPer.set(u.id, { x: u.position.x, y: u.position.y });
      // Only counts against a unit that still has somewhere to be.
      const busy = !arrivedAtPer.has(u.id);
      if (busy && moved < gameConfig.behavior.stuckEpsilon) {
        stalled++;
        const n = (streaks.get(u.id) ?? 0) + 1;
        streaks.set(u.id, n);
        if (n > worstStreak) worstStreak = n;
      } else streaks.set(u.id, 0);

      const r = (u.movement.retreatTime ?? 0) > 0;
      if (r && !wasRetreatingPer.get(u.id)) retreats++;
      wasRetreatingPer.set(u.id, r);

      if (busy && distance(u.position.x, u.position.y, goal.x, goal.y) < ARRIVE) arrivedAtPer.set(u.id, t);
    }

    for (const u of pack) {
      const ut = tileOf(u.position);
      if (isBlockedGrid(grid, ut.tx, ut.ty)) inRock++;
    }
  }

  const left = Math.max(...pack.map((u) => distance(u.position.x, u.position.y, goal.x, goal.y)));
  const last = arrivedAtPer.size ? Math.max(...arrivedAtPer.values()) : -1;
  console.log(
    `${name.padEnd(22)} arrived ${String(arrivedAtPer.size).padStart(2)}/${pack.length}` +
      ` last ${last >= 0 ? `${last}t` : '-'} worstLeft ${left.toFixed(0)}px` +
      ` | stalled ${stalled} (worst streak ${worstStreak}) | inRock ${inRock} | retreats ${retreats}`,
  );
}

/** A solid wall across the path with a wide opening, forcing a route past its end. */
function wall(tx: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let ty = from; ty <= to; ty++) out.push([tx, ty]);
  return out;
}

describe('stuck beside rock', () => {
  it('drives a lone unit past terrain', () => {
    const cfg = gameConfig.behavior.orca as { enabled: boolean };
    const was = cfg.enabled;
    try {
      for (const layer of ['steer', 'orca'] as const) {
        cfg.enabled = layer === 'orca';
        console.log(`--- ${layer} ---`);
        for (const crowd of [1, 4, 8]) {
          drive(`x${crowd} single tile`, [[20, 20]], 10, 30, 20, crowd);
          drive(`x${crowd} 2x2 block`, [[20, 20], [21, 20], [20, 21], [21, 21]], 10, 30, 20, crowd);
          drive(`x${crowd} round a wall end`, wall(20, 20, 34), 10, 30, 25, crowd);
          drive(`x${crowd} out of a notch`, [...wall(19, 18, 22), [20, 18], [21, 18], [20, 22], [21, 22]], 20, 34, 20, crowd);
        }
      }
    } finally {
      cfg.enabled = was;
      applyMapSize(MapSize.Medium);
    }
  }, 120_000);
});
