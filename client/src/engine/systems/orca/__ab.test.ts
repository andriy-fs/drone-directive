import { describe, it, vi } from 'vitest';
import { ChassisType, FormationType, MapSize, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { applyMapSize, gameConfig } from '../../../config/gameConfig';
import type { BaseEntity, RobotEntity } from '../../ecs/archetypes';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import { resetIds } from '../../../utils/id';
import { refreshNavObstacles } from '../../navGrid';
import { isBlockedGrid, tileCentre, tileOf } from '../../obstacles';
import { distance } from '../../../utils/math';
import { makeCtx } from '../testkit';
import { commandsSystem } from '../commands';
import { movementSystem } from '../movement';
import { separationSystem } from '../separation';
import { baseFootprintContains } from '../../targeting';
import { visionSystem } from '../vision';
import { taskSystem } from '../task';

/**
 * A/B harness for the local-avoidance layer — NOT a test. Nothing is asserted; it
 * plays the same seeded matches and prints what happened, so a change to how units
 * yield to each other can be judged against the layer it replaces. Delete with the
 * ORCA task.
 *
 * Conditions are the ones `__stress.test.ts` established and the flow-field
 * investigation already trusts: small map, real generated terrain, 5 Box groups on
 * Attack Base, 10 seeds, 2700 ticks. Combat is deliberately absent — nobody dies,
 * so a unit that jams stays jammed and can be measured instead of being deleted by
 * the base turret. `visionSystem` is not optional: `engageOutcome` only stops a
 * hull once the target is *visible*, and without it nobody could ever stop driving
 * and the crowd at the objective becomes an artefact of the harness.
 *
 * The `replayHash` column is the point of the whole file for stages 1 and 3: a
 * refactor that is supposed to change nothing must reproduce it exactly, which
 * separates "the restructure broke something" from "the new solver behaves
 * differently".
 */

const H = vi.hoisted(() => ({ pathCalls: 0 }));

/**
 * Counts `findPath` without changing it. Every call delegates to the real
 * implementation, so this cannot move a single float — it exists because "did the
 * avoidance layer make units re-path more?" is one of the gate's questions and
 * nothing else can answer it.
 */
vi.mock('../../pathfinding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pathfinding')>();
  return {
    ...actual,
    findPath(...args: Parameters<typeof actual.findPath>) {
      H.pathCalls++;
      return actual.findPath(...args);
    },
  };
});

const DT = 1 / 30;
const TICKS = 2700;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CONTACT = gameConfig.robots.radius * 2;

const LOADOUTS: Record<number, { groups: number; weapons: WeaponType[] }> = {
  12: { groups: 2, weapons: [WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar] },
  24: { groups: 4, weapons: [WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar] },
  50: {
    groups: 5,
    weapons: [
      WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon, WeaponType.Cannon,
      WeaponType.Missiles, WeaponType.Missiles, WeaponType.Ew, WeaponType.Radar,
    ],
  },
};

function playMatch(seed: number, total: number) {
  const { groups: GROUPS, weapons: WEAPONS } = LOADOUTS[total];
  const PER_GROUP = WEAPONS.length;
  // Entity ids come off a module-global counter and lockstep requires a match to
  // start numbering from scratch; without this the second play of a seed diverges
  // and reads as engine non-determinism rather than a harness omission.
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

  const start = tileOf(home.position);
  const spots: { tx: number; ty: number }[] = [];
  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const queue = [start];
  while (queue.length && spots.length < GROUPS * PER_GROUP) {
    const cur = queue.shift();
    if (!cur) break;
    if (!isBlockedGrid(ctx.navObstacles, cur.tx, cur.ty)) spots.push(cur);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { tx: cur.tx + dx, ty: cur.ty + dy };
      const k = `${next.tx},${next.ty}`;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(next);
    }
  }

  const all: RobotEntity[] = [];
  for (let g = 0; g < GROUPS; g++) {
    const members: RobotEntity[] = [];
    for (let i = 0; i < PER_GROUP; i++) {
      const spot = spots[g * PER_GROUP + i];
      members.push(
        spawnRobot(ctx.world, Owner.Player, tileCentre(spot.tx, spot.ty), ChassisType.Tracks, WEAPONS[i]) as RobotEntity,
      );
    }
    ctx.commands.push({ kind: 'SetFormation', robotIds: members.map((e) => e.id), formation: FormationType.Box });
    for (const e of members) ctx.commands.push({ kind: 'AssignTask', robotId: e.id, task: TaskType.AttackBase });
    all.push(...members);
  }

  const toFoe = (p: { x: number; y: number }) => distance(p.x, p.y, foe.position.x, foe.position.y);
  const arrivedAt = new Map<string, number>();
  const last = new Map<string, { x: number; y: number }>();
  const wasRetreating = new Map<string, boolean>();
  let retreats = 0;
  let overlapPairs = 0;
  let ticksInTerrain = 0;
  let ticksInFootprint = 0;
  let stalledEnRoute = 0;
  let enRouteRobotTicks = 0;
  let foeFootprintTicks = 0;
  // How the march splits between units the solver steers and units it must treat
  // as immovable: a formation `hold` clears the goal, so the hull registers
  // passive and everyone else owes it the whole correction.
  let heldTicks = 0;
  let drivingTicks = 0;

  for (let t = 0; t < TICKS; t++) {
    commandsSystem(ctx);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    movementSystem(ctx, DT);
    separationSystem(ctx);

    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (distance(a.position.x, a.position.y, b.position.x, b.position.y) < CONTACT - 1e-6) overlapPairs++;
      }
    }

    for (const e of all) {
      const prev = last.get(e.id);
      const moved = prev ? distance(e.position.x, e.position.y, prev.x, prev.y) : Infinity;
      last.set(e.id, { x: e.position.x, y: e.position.y });

      const retreating = (e.movement.retreatTime ?? 0) > 0;
      if (retreating && !wasRetreating.get(e.id)) retreats++;
      wasRetreating.set(e.id, retreating);

      // Split on purpose. `navObstacles` is terrain **plus living base
      // footprints**, so a single "inside blocked ground" counter is dominated by
      // the at-objective crowd standing on the enemy base — the defect the
      // flow-field investigation already isolated, and nothing to do with whether
      // the avoidance layer shoves hulls into rock. Averaging the two together is
      // the same mistake this repo has now made three times; `ticksInTerrain` is
      // the one the wall constraints are answerable for.
      const tile = tileOf(e.position);
      if (isBlockedGrid(ctx.obstacles, tile.tx, tile.ty)) ticksInTerrain++;
      if (isBlockedGrid(ctx.navObstacles, tile.tx, tile.ty)) ticksInFootprint++;
      if (baseFootprintContains(foe, e.position)) foeFootprintTicks++;

      if (!arrivedAt.has(e.id) && toFoe(e.position) < 250) arrivedAt.set(e.id, t);
      if (!arrivedAt.has(e.id)) {
        if (e.movement.goal === undefined) heldTicks++;
        else drivingTicks++;
        enRouteRobotTicks++;
        if (e.movement.goal !== undefined && moved < gameConfig.behavior.stuckEpsilon) stalledEnRoute++;
      }
    }
  }

  return {
    units: all.length,
    arrived: arrivedAt.size,
    arrivals: [...arrivedAt.values()],
    retreats,
    overlapPairs,
    ticksInTerrain,
    ticksInFootprint,
    stalledEnRoute,
    enRouteRobotTicks,
    foeFootprintTicks,
    heldTicks,
    drivingTicks,
    // Quantised exactly as `worldHash` does, so the fingerprint has the same
    // resolution the desync detector uses in a real match.
    hash: all.map((e) => `${e.position.x.toFixed(3)},${e.position.y.toFixed(3)}`).join('|'),
  };
}

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('A/B — local avoidance, 10 seeds x 2700 ticks', () => {
  it('reports both avoidance layers', () => {
    const pad = (s: string | number, n: number) => String(s).padStart(n);
    const cfg = gameConfig.behavior.orca as { enabled: boolean };
    const was = cfg.enabled;

    console.log(
      '\nlayer    n   arrived  meanArr   enRoute  retreats  overlap/t  inTerrain  inBlocked  foeFP/u  held%  findPath  replayHash',
    );

    try {
      for (const layer of ['steer', 'orca'] as const) {
        cfg.enabled = layer === 'orca';
        for (const total of [12, 24, 50]) {
          H.pathCalls = 0;
          let arrived = 0;
          let units = 0;
          let arrivals: number[] = [];
          let retreats = 0;
          let overlapPairs = 0;
          let ticksInTerrain = 0;
          let ticksInFootprint = 0;
          let stalledEnRoute = 0;
          let enRouteRobotTicks = 0;
          let foeFootprintTicks = 0;
          let heldTicks = 0;
          let drivingTicks = 0;
          const hashes: string[] = [];

          for (const seed of SEEDS) {
            const r = playMatch(seed, total);
            arrived += r.arrived;
            units += r.units;
            arrivals = arrivals.concat(r.arrivals);
            retreats += r.retreats;
            overlapPairs += r.overlapPairs;
            ticksInTerrain += r.ticksInTerrain;
            ticksInFootprint += r.ticksInFootprint;
            stalledEnRoute += r.stalledEnRoute;
            enRouteRobotTicks += r.enRouteRobotTicks;
            foeFootprintTicks += r.foeFootprintTicks;
            heldTicks += r.heldTicks;
            drivingTicks += r.drivingTicks;
            hashes.push(r.hash);
          }

          const mean = arrivals.length ? arrivals.reduce((a, b) => a + b, 0) / arrivals.length : 0;
          console.log(
            `${layer.padEnd(6)}${pad(total, 4)}${pad(`${arrived}/${units}`, 10)}${pad(mean.toFixed(0), 9)}` +
              `${pad(((stalledEnRoute / Math.max(1, enRouteRobotTicks)) * 100).toFixed(2) + '%', 10)}` +
              `${pad(retreats, 10)}${pad((overlapPairs / (SEEDS.length * TICKS)).toFixed(3), 11)}` +
              `${pad(ticksInTerrain, 11)}${pad(ticksInFootprint, 11)}` +
              `${pad((foeFootprintTicks / Math.max(1, arrived)).toFixed(0), 9)}` +
              `${pad(((heldTicks / Math.max(1, heldTicks + drivingTicks)) * 100).toFixed(1) + '%', 7)}` +
              `${pad(H.pathCalls, 10)}  ${fnv(hashes.join('#'))}`,
          );
        }
      }
    } finally {
      cfg.enabled = was;
      applyMapSize(MapSize.Medium);
    }
  }, 1_800_000);
});
