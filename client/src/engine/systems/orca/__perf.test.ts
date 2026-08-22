import { describe, it } from 'vitest';
import { ChassisType, FormationType, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../config/gameConfig';
import type { BaseEntity, RobotEntity } from '../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import { resetIds } from '../../../utils/id';
import { refreshNavObstacles } from '../../navGrid';
import { isBlockedGrid, tileCentre, tileOf } from '../../obstacles';
import { makeCtx } from '../testkit';
import { commandsSystem } from '../commands';
import { movementSystem } from '../movement';
import { separationSystem } from '../separation';
import { visionSystem } from '../vision';
import { taskSystem } from '../task';

/** Temporary: what the avoidance layer costs per tick. */

const DT = 1 / 30;
const TICKS = 1200;

function build(units: number) {
  resetIds();
  applyMapSize(MapSize.Small);
  const ctx = makeCtx(1);
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
  while (queue.length && spots.length < units) {
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
  const members: RobotEntity[] = [];
  for (let i = 0; i < units; i++) {
    const s = spots[i];
    members.push(
      spawnRobot(ctx.world, Owner.Player, tileCentre(s.tx, s.ty), ChassisType.Tracks, WeaponType.Cannon) as RobotEntity,
    );
  }
  ctx.commands.push({ kind: 'SetFormation', robotIds: members.map((e) => e.id), formation: FormationType.Box });
  for (const e of members) ctx.commands.push({ kind: 'AssignTask', robotId: e.id, task: TaskType.AttackBase });
  return ctx;
}

function timeIt(units: number): { total: number; movement: number } {
  const ctx = build(units);
  let movement = 0;
  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) {
    commandsSystem(ctx);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    const m0 = performance.now();
    movementSystem(ctx, DT);
    movement += performance.now() - m0;
    separationSystem(ctx);
  }
  return { total: performance.now() - t0, movement };
}

describe('avoidance cost per tick', () => {
  it('times both layers', () => {
    const cfg = gameConfig.behavior.orca as { enabled: boolean };
    const was = cfg.enabled;
    try {
      for (const units of [12, 24, 50]) {
        for (const layer of ['steer', 'orca'] as const) {
          cfg.enabled = layer === 'orca';
          timeIt(units); // warm up the JIT before the measured run
          const r = timeIt(units);
          console.log(
            `${layer.padEnd(6)} ${String(units).padStart(3)} units | movementSystem ${(r.movement / TICKS).toFixed(3)} ms/tick` +
              ` | whole pipeline ${(r.total / TICKS).toFixed(3)} ms/tick`,
          );
        }
      }
    } finally {
      cfg.enabled = was;
      applyMapSize(MapSize.Medium);
    }
  }, 600_000);
});
