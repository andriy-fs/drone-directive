import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { BuildPresetType, ChassisType, Owner, TaskType, WeaponType } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { makeAttackBase, makeAttackRobots, makeAttackTarget, makeGuard } from '../tasks/taskDefinitions';
import { knownEnemyRobots } from './targeting';
import { atRobotCap } from './production';

/** The AI's production series (every 10th unit is a kamikaze, sent at a cluster or the base). */
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

  ensureEwRobot(ctx, base);
  updateProduction(ctx, base, dt);
  assignIdleUnits(ctx, base);
}

/**
 * Keeps one EW jammer alive/queued at all times — cheapest hull (wheels) since
 * it's a support unit, not a combatant, and it's ordered to Guard so it stays
 * near the base instead of wandering off with an attack wave. Runs every tick
 * (not gated by the normal production cadence) so a dead jammer gets replaced
 * as soon as the AI can afford one, independent of whatever else is queued.
 */
function ensureEwRobot(ctx: GameContext, base: Entity): void {
  if (atRobotCap(ctx, Owner.AI)) return;
  const hasEw = ctx.world
    .with('robot')
    .entities.some((e) => e.owner === Owner.AI && (e.hp ?? 0) > 0 && e.weaponType === WeaponType.Ew);
  if (hasEw) return;
  if (base.production!.queue.some((o) => o.weapon === WeaponType.Ew)) return;

  const order = { chassis: ChassisType.Wheels, weapon: WeaponType.Ew, task: TaskType.Guard };
  const cost = buildCost(order);
  if (!canAfford(ctx.resources, Owner.AI, cost)) return;

  spend(ctx.resources, Owner.AI, cost);
  base.production!.queue.push(order);
}

function updateProduction(ctx: GameContext, base: Entity, dt: number): void {
  ctx.ai.timer += dt;
  if (ctx.ai.timer < ctx.ai.nextIn) return;

  if (atRobotCap(ctx, Owner.AI)) return; // shared per-side cap (same as the player)

  // Pull the next order from the preset sequence (cycling); the kamikaze bomb
  // lands as every 10th build (target picked later by `assignKamikaze`, once it
  // exists). The AI keeps its own build cadence.
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
 * Assigns programs to Idle AI robots. Under threat, `mobilizeDefense` takes over
 * (checked before the Idle-only slice below, so a base defended purely by
 * Guards — no Idle units at all — still responds). Otherwise a freshly-idle
 * kamikaze bomb gets an immediate target of its own (see `assignKamikaze`)
 * instead of joining the guard/wave pipeline; the rest fill the guard quota,
 * then *stage* near base and only release once a full wave (2–4) has gathered,
 * so the AI attacks in groups instead of trickling out one robot at a time.
 */
function assignIdleUnits(ctx: GameContext, base: Entity): void {
  const aiRobots = ctx.world
    .with('robot', 'position', 'script')
    .entities.filter((e) => e.owner === Owner.AI);

  if (isThreatened(ctx, base)) {
    mobilizeDefense(ctx, base, aiRobots);
    return;
  }

  const idle = aiRobots.filter((e) => e.script!.programId === TaskType.Idle);
  if (idle.length === 0) return;

  const bombers = idle.filter((e) => e.weaponType === WeaponType.Bomb);
  for (const bomber of bombers) assignKamikaze(ctx, bomber);
  const rest = idle.filter((e) => e.weaponType !== WeaponType.Bomb);

  let guards = aiRobots.filter((e) => e.script!.programId === TaskType.Guard).length;
  const staged: Entity[] = [];
  for (const robot of rest) {
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

/**
 * Sends a freshly-idle kamikaze at whichever is more worthwhile: a tight
 * cluster of known enemy robots that would all catch the blast, or the base.
 * Cluster runs only happen when one is big enough (`kamikazeClusterMin`) and
 * the roll (`kamikazeClusterChance`) favours it — otherwise it's a base rush,
 * same as before.
 */
function assignKamikaze(ctx: GameContext, bomber: Entity): void {
  const cluster = juiciestCluster(ctx, bomber);
  if (
    cluster &&
    cluster.count >= gameConfig.ai.kamikazeClusterMin &&
    ctx.rng.next() < gameConfig.ai.kamikazeClusterChance
  ) {
    bomber.script = makeAttackTarget(cluster.targetId);
  } else {
    bomber.script = makeAttackBase();
  }
}

/**
 * The known enemy robot with the most *other* known enemy robots huddled
 * within the bomb's blast radius of it — walking the kamikaze onto that one
 * catches the rest in the same detonation. Undefined if none are known yet.
 */
function juiciestCluster(ctx: GameContext, bomber: Entity): { targetId: string; count: number } | undefined {
  const foes = knownEnemyRobots(ctx, bomber.owner!);
  const radius = gameConfig.robots.weapons.bomb.explosionRadius;
  let best: Entity | undefined;
  let bestCount = 0;
  for (const foe of foes) {
    const count = foes.filter(
      (o) => o.id !== foe.id && distance(o.position!.x, o.position!.y, foe.position!.x, foe.position!.y) <= radius,
    ).length;
    if (count > bestCount) {
      bestCount = count;
      best = foe;
    }
  }
  return best ? { targetId: best.id, count: bestCount } : undefined;
}

/** A random attack-wave size in [attackGroupMin, attackGroupMax]. */
function rollAttackGroup(rng: Rng): number {
  const { attackGroupMin: lo, attackGroupMax: hi } = gameConfig.ai;
  return lo + rng.int(hi - lo + 1);
}

/**
 * Reassigns AI robots when the base is under threat. Below `massRushThreshold`
 * only "home-based" robots (Idle/Guard) join the fight, so a minor skirmish
 * doesn't derail an attack wave already under way; at/above it, the AI recalls
 * everything it can fight with — including robots mid-attack — since losing the
 * base outright is worse than losing offensive tempo.
 */
function mobilizeDefense(ctx: GameContext, base: Entity, aiRobots: Entity[]): void {
  const massRush = nearbyPlayerCount(ctx, base) >= gameConfig.ai.massRushThreshold;
  for (const robot of aiRobots) {
    if (robot.weaponType === WeaponType.Ew) continue; // unarmed — nothing to fight with, stays put
    const programId = robot.script!.programId;
    if (programId === TaskType.AttackRobots) continue; // already mobilized — don't reset its blackboard/roamTarget
    const homeBound = programId === TaskType.Idle || programId === TaskType.Guard;
    if (massRush || homeBound) robot.script = makeAttackRobots();
  }
}

function isThreatened(ctx: GameContext, base: Entity): boolean {
  return nearbyPlayerCount(ctx, base) > 0;
}

/** Living player robots within `threatRange` of the base, right now. */
function nearbyPlayerCount(ctx: GameContext, base: Entity): number {
  const bp = base.position!;
  return ctx.world
    .with('robot', 'position')
    .entities.filter(
      (r) =>
        r.owner === Owner.Player &&
        distance(r.position!.x, r.position!.y, bp.x, bp.y) < gameConfig.ai.threatRange,
    ).length;
}

function guardPost(base: Entity, rng: Rng): Vec2 {
  const bp = base.position!;
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2;
  const angle = rng.next() * Math.PI * 2;
  const dist = half + 20 + rng.next() * gameConfig.ai.guardRadius;
  return { x: bp.x + Math.cos(angle) * dist, y: bp.y + Math.sin(angle) * dist };
}
