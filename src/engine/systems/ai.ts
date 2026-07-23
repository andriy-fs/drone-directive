import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { BuildPresetType, Owner, TaskType } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { makeAttackBase, makeAttackRobots, makeGuard } from '../tasks/taskDefinitions';
import { atRobotCap } from './production';

/** The AI's production series (every 10th unit is a base-rushing kamikaze). */
const AI_BUILD_PRESET = BuildPresetType.AiAssault;

/**
 * Drives the AI: resource-gated escalating production off a build preset, plus
 * staged task assignment (guard quota → hold offensive units back → release them
 * in waves of 2–4 → intercept threats). Recomputed from live counts.
 */
export function aiSystem(ctx: GameContext, dt: number): void {
  const base = ctx.world
    .with('base', 'position', 'production')
    .entities.find((e) => e.owner === Owner.AI && (e.hp ?? 0) > 0);
  if (!base) return;

  updateProduction(ctx, base, dt);
  assignIdleUnits(ctx, base);
}

function updateProduction(ctx: GameContext, base: Entity, dt: number): void {
  ctx.ai.timer += dt;
  if (ctx.ai.timer < ctx.ai.nextIn) return;

  if (atRobotCap(ctx, Owner.AI)) return; // shared per-side cap (same as the player)

  // Pull the next order from the preset sequence (cycling); the kamikaze bomb
  // lands as every 10th build. The AI keeps its own build cadence.
  const sequence = getBuildPreset(AI_BUILD_PRESET).sequence;
  const order = sequence[ctx.ai.buildStep % sequence.length];
  const cost = buildCost(order);
  if (!canAfford(ctx.resources, Owner.AI, cost)) return; // wait, retry next tick

  spend(ctx.resources, Owner.AI, cost);
  base.production!.queue.push({ ...order });
  ctx.ai.buildStep += 1;
  ctx.ai.timer = 0;
  ctx.ai.nextIn = ctx.ai.interval;
  ctx.ai.interval = Math.max(gameConfig.ai.minInterval, ctx.ai.interval * gameConfig.ai.intervalDecay);
}

/**
 * Assigns programs to Idle AI robots. Under threat, everything idle intercepts
 * at once (defence first). Otherwise it fills the guard quota, then *stages* the
 * rest near base and only releases them once a full wave (2–4) has gathered, so
 * the AI attacks in groups instead of trickling out one robot at a time. Units
 * the preset already programmed (e.g. the kamikaze) aren't Idle, so they're
 * skipped and act immediately.
 */
function assignIdleUnits(ctx: GameContext, base: Entity): void {
  const aiRobots = ctx.world
    .with('robot', 'position', 'script')
    .entities.filter((e) => e.owner === Owner.AI);
  const idle = aiRobots.filter((e) => e.script!.programId === TaskType.Idle);
  if (idle.length === 0) return;

  if (isThreatened(ctx, base)) {
    for (const robot of idle) robot.script = makeAttackRobots();
    return;
  }

  let guards = aiRobots.filter((e) => e.script!.programId === TaskType.Guard).length;
  const staged: Entity[] = [];
  for (const robot of idle) {
    if (guards < gameConfig.ai.guardQuota) {
      robot.script = makeGuard(guardPost(base, ctx.rng));
      guards += 1;
    } else {
      staged.push(robot); // hold near base until a wave forms
    }
  }

  if (ctx.ai.groupTarget <= 0) ctx.ai.groupTarget = rollAttackGroup(ctx.rng);
  if (staged.length >= ctx.ai.groupTarget) {
    for (const robot of staged.slice(0, ctx.ai.groupTarget)) robot.script = makeAttackBase();
    ctx.ai.groupTarget = rollAttackGroup(ctx.rng); // size the next wave
  }
}

/** A random attack-wave size in [attackGroupMin, attackGroupMax]. */
function rollAttackGroup(rng: Rng): number {
  const { attackGroupMin: lo, attackGroupMax: hi } = gameConfig.ai;
  return lo + rng.int(hi - lo + 1);
}

function isThreatened(ctx: GameContext, base: Entity): boolean {
  const bp = base.position!;
  return ctx.world
    .with('robot', 'position')
    .entities.some(
      (r) =>
        r.owner === Owner.Player &&
        distance(r.position!.x, r.position!.y, bp.x, bp.y) < gameConfig.ai.threatRange,
    );
}

function guardPost(base: Entity, rng: Rng): Vec2 {
  const bp = base.position!;
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2;
  const angle = rng.next() * Math.PI * 2;
  const dist = half + 20 + rng.next() * gameConfig.ai.guardRadius;
  return { x: bp.x + Math.cos(angle) * dist, y: bp.y + Math.sin(angle) * dist };
}
