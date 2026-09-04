import { describe, it } from 'vitest';
import { ChassisType, FormationType, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../../config/gameConfig';
import type { BaseEntity, RobotEntity } from '../../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../../ecs/factory';
import { resetIds } from '../../../../utils/id';
import { refreshNavObstacles } from '../../../navGrid';
import { isBlockedGrid, tileCentre, tileOf } from '../../../obstacles';
import { distance } from '../../../../utils/math';
import { makeCtx } from '../../testkit';
import { commandsSystem } from '../../commands';
import { movementSystem } from '..';
import { separationSystem } from '../../separation';
import { visionSystem } from '../../vision';
import { taskSystem } from '../../task';

/**
 * Temporary: tunes the ORCA horizons on the regime that actually hurts — real
 * generated terrain, five Box formations, fifty units — rather than on the
 * corridor stand where they were first set. Delete once the numbers are chosen.
 *
 * Skipped by default; it is minutes long. Drop the `.skip` to re-tune.
 */

const DT = 1 / 30;
const TICKS = 2000;
const SEEDS = [1, 2, 3, 4, 5];
const WEAPONS = [
  WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon,
  WeaponType.Missiles, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar,
];

function playMatch(seed: number, formed = true) {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(seed);
  let home: BaseEntity | undefined;
  let foe: BaseEntity | undefined;
  for (const p of gameConfig.bases.placements) {
    const b = spawnBase(ctx.world, p.owner, p.tx, p.ty);
    if (p.owner === Owner.Player) home = b;
    else foe = b;
  }
  if (!home || !foe) throw new Error('two bases');
  refreshNavObstacles(ctx);
  ctx.intel[Owner.Player].knownBaseIds.add(foe.id);

  const start = tileOf(home.position);
  const spots: { tx: number; ty: number }[] = [];
  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const queue = [start];
  while (queue.length && spots.length < 50) {
    const cur = queue.shift();
    if (!cur) break;
    if (!isBlockedGrid(ctx.navObstacles, cur.tx, cur.ty)) spots.push(cur);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${cur.tx + dx},${cur.ty + dy}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ tx: cur.tx + dx, ty: cur.ty + dy });
    }
  }

  const all: RobotEntity[] = [];
  for (let g = 0; g < 5; g++) {
    const members: RobotEntity[] = [];
    for (let i = 0; i < 10; i++) {
      const s = spots[g * 10 + i];
      members.push(
        spawnRobot(ctx.world, Owner.Player, tileCentre(s.tx, s.ty), ChassisType.Tracks, WEAPONS[i]) as RobotEntity,
      );
    }
    if (formed) {
      ctx.commands.push({ kind: 'SetFormation', robotIds: members.map((e) => e.id), formation: FormationType.Box });
    }
    for (const e of members) ctx.commands.push({ kind: 'AssignTask', robotId: e.id, task: TaskType.AttackBase });
    all.push(...members);
  }

  const arrived = new Map<string, number>();
  let inTerrain = 0;
  let overlaps = 0;
  // Mean speed while actually under way. The old layer only ever turned a hull;
  // it never slowed one. ORCA can do both, so this is where a structural
  // slowdown would show up regardless of any horizon.
  let speedSum = 0;
  let speedTicks = 0;
  let heldTicks = 0;
  // Odometer against crow-flight: if hulls are not slower but still arrive later,
  // the time is going into extra ground.
  const odometer = new Map<string, number>();
  const startAt = new Map<string, { x: number; y: number }>();
  const prevAt = new Map<string, { x: number; y: number }>();
  for (const e of all) {
    startAt.set(e.id, { x: e.position.x, y: e.position.y });
    prevAt.set(e.id, { x: e.position.x, y: e.position.y });
    odometer.set(e.id, 0);
  }
  const contact = gameConfig.robots.radius * 2;

  for (let t = 0; t < TICKS; t++) {
    commandsSystem(ctx);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    movementSystem(ctx, DT);
    separationSystem(ctx);
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        if (distance(a.position.x, a.position.y, all[j].position.x, all[j].position.y) < contact - 1e-6) overlaps++;
      }
    }
    for (const e of all) {
      const pv = prevAt.get(e.id);
      if (pv) {
        if (!arrived.has(e.id)) {
          odometer.set(e.id, (odometer.get(e.id) ?? 0) + distance(e.position.x, e.position.y, pv.x, pv.y));
        }
        pv.x = e.position.x;
        pv.y = e.position.y;
      }
      if (!arrived.has(e.id)) {
        if (e.movement.goal === undefined) heldTicks++;
        else {
          speedSum += Math.sqrt(e.movement.velX ** 2 + e.movement.velY ** 2);
          speedTicks++;
        }
      }
      const tile = tileOf(e.position);
      if (isBlockedGrid(ctx.obstacles, tile.tx, tile.ty)) inTerrain++;
      if (!arrived.has(e.id) && distance(e.position.x, e.position.y, foe.position.x, foe.position.y) < 250) {
        arrived.set(e.id, t);
      }
    }
  }
  return {
    arrived: arrived.size,
    mean: [...arrived.values()],
    inTerrain,
    overlaps,
    units: all.length,
    speedSum,
    speedTicks,
    heldTicks,
    detours: [...arrived.keys()].map((id) => {
      const s0 = startAt.get(id);
      const crow = s0 ? distance(s0.x, s0.y, foe.position.x, foe.position.y) - 250 : 0;
      return crow > 1 ? (odometer.get(id) ?? 0) / crow : 1;
    }),
  };
}

function arm(formed = true): string {
  let arrived = 0;
  let units = 0;
  let inTerrain = 0;
  let overlaps = 0;
  let ticks: number[] = [];
  let speedSum = 0;
  let speedTicks = 0;
  let heldTicks = 0;
  let detours: number[] = [];
  for (const seed of SEEDS) {
    const r = playMatch(seed, formed);
    arrived += r.arrived;
    units += r.units;
    inTerrain += r.inTerrain;
    overlaps += r.overlaps;
    ticks = ticks.concat(r.mean);
    speedSum += r.speedSum;
    speedTicks += r.speedTicks;
    heldTicks += r.heldTicks;
    detours = detours.concat(r.detours);
  }
  const mean = ticks.length ? ticks.reduce((a, b) => a + b, 0) / ticks.length : 0;
  const speed = speedTicks ? speedSum / speedTicks : 0;
  const detour = detours.length ? detours.reduce((a, b) => a + b, 0) / detours.length : 0;
  const held = (heldTicks / Math.max(1, heldTicks + speedTicks)) * 100;
  return (
    `arrived ${arrived}/${units}  mean ${mean.toFixed(0)}  inTerrain ${inTerrain}` +
    `  overlap/t ${(overlaps / (SEEDS.length * TICKS)).toFixed(2)}  speed ${speed.toFixed(1)}px/s` +
    `  held ${held.toFixed(1)}%  detour x${detour.toFixed(2)}`
  );
}

describe('orca tuning on generated terrain, 50 units in 5 boxes', () => {
  it('sweeps the horizons where it hurts', () => {
    const cfg = gameConfig.behavior.orca as {
      enabled: boolean;
      timeHorizon: number;
      timeHorizonMin: number;
      timeHorizonObst: number;
    };
    const was = { ...cfg };
    try {
      cfg.enabled = false;
      console.log(`steer                  ${arm(true)}`);
      cfg.enabled = true;
      cfg.timeHorizon = 0.1;
      cfg.timeHorizonMin = 0.05;
      cfg.timeHorizonObst = 0.2;
      const tune = cfg as unknown as { prefInertia: number };
      for (const tau of [0.1, 0.2, 0.35]) {
        for (const inertia of [0.4, 0.5, 0.6]) {
          cfg.timeHorizon = tau;
          cfg.timeHorizonMin = Math.min(0.05, tau);
          tune.prefInertia = inertia;
          console.log(`orca tau ${tau.toFixed(2)} inertia ${inertia.toFixed(2)}  ${arm(true)}`);
        }
      }
    } finally {
      Object.assign(cfg, was);
      applyMapSize(MapSize.Medium);
    }
  }, 1_800_000);
});
