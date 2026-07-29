import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { BuildPresetType, ChassisType, Controller, TaskType, WeaponType, type Owner } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { AiState, GameContext } from '../game/context';
import { makeAttackBase, makeAttackRobots, makeAttackTarget, makeGuard } from '../tasks/taskDefinitions';
import { isEnemy, knownEnemyRobots } from './targeting';
import { atRobotCap } from './production';

/** The AI's production series (every 10th unit is a kamikaze, sent at a cluster or the base). */
const AI_BUILD_PRESET = BuildPresetType.AiAssault;

/**
 * Drives every bot side, each from its own `AiState` and in roster order (fixed
 * across networked peers, which matters because the bots draw from the shared
 * match rng). Bots are hostile to *everyone* they don't own, other bots
 * included — this is a free-for-all, there are no alliances.
 */
export function aiSystem(ctx: GameContext, dt: number): void {
  for (const side of ctx.roster) {
    if (side.controller !== Controller.Bot) continue;
    const state = ctx.ai[side.owner];
    if (state) runBot(ctx, side.owner, state, dt);
  }
}

/**
 * One bot's turn: resource-gated escalating production off a build preset, plus
 * staged task assignment (guard quota → hold offensive units back → release them
 * in waves of 2–4 → intercept threats). Recomputed from live counts.
 */
function runBot(ctx: GameContext, owner: Owner, state: AiState, dt: number): void {
  const base = ctx.world
    .with('base', 'position', 'production')
    .entities.find((e) => e.owner === owner && (e.hp ?? 0) > 0);
  if (!base) return;

  ensureEwRobot(ctx, owner, base);
  updateProduction(ctx, owner, state, base, dt);
  assignIdleUnits(ctx, owner, state, base);
}

/**
 * Keeps one EW jammer alive/queued at all times — cheapest hull (wheels) since
 * it's a support unit, not a combatant, and it's ordered to Guard so it stays
 * near the base instead of wandering off with an attack wave. Runs every tick
 * (not gated by the normal production cadence) so a dead jammer gets replaced
 * as soon as the AI can afford one, independent of whatever else is queued.
 */
function ensureEwRobot(ctx: GameContext, owner: Owner, base: Entity): void {
  if (atRobotCap(ctx, owner)) return;
  const hasEw = ctx.world
    .with('robot')
    .entities.some((e) => e.owner === owner && (e.hp ?? 0) > 0 && e.weaponType === WeaponType.Ew);
  if (hasEw) return;
  if (base.production!.queue.some((o) => o.weapon === WeaponType.Ew)) return;

  const order = { chassis: ChassisType.Wheels, weapon: WeaponType.Ew, task: TaskType.Guard };
  const cost = buildCost(order);
  if (!canAfford(ctx.resources, owner, cost)) return;

  spend(ctx.resources, owner, cost);
  base.production!.queue.push(order);
}

function updateProduction(ctx: GameContext, owner: Owner, state: AiState, base: Entity, dt: number): void {
  state.timer += dt;
  if (state.timer < state.nextIn) return;

  if (atRobotCap(ctx, owner)) return; // shared per-side cap (same as the player)

  // Pull the next order from the preset sequence (cycling); the kamikaze bomb
  // lands as every 10th build (target picked later by `assignKamikaze`, once it
  // exists). Each bot keeps its own build cadence.
  const sequence = getBuildPreset(AI_BUILD_PRESET).sequence;
  const order = sequence[state.buildStep % sequence.length];
  const cost = buildCost(order);
  if (!canAfford(ctx.resources, owner, cost)) return; // wait, retry next tick

  spend(ctx.resources, owner, cost);
  base.production!.queue.push({ ...order });
  state.buildStep += 1;
  state.timer = 0;
  state.nextIn = state.interval;
  state.interval = Math.max(gameConfig.ai.minInterval, state.interval * gameConfig.ai.intervalDecay);
}

/**
 * Assigns programs to Idle AI robots. Under threat, `mobilizeDefense` takes over
 * (checked before the Idle-only slice below, so a base defended purely by
 * Guards — no Idle units at all — still responds). Otherwise behaviour depends
 * on `forcePosture`: outnumbered → turtle up (bigger guard line, no offensive
 * wave, kamikaze stays home too); significantly ahead → press the advantage
 * immediately instead of waiting for a full wave; roughly even → the original
 * behaviour — fill the guard quota, *stage* the rest near base, and only
 * release once a full wave (2–4) has gathered, so the AI attacks in groups
 * instead of trickling out one robot at a time.
 */
function assignIdleUnits(ctx: GameContext, owner: Owner, state: AiState, base: Entity): void {
  const aiRobots = ctx.world.with('robot', 'position', 'script').entities.filter((e) => e.owner === owner);

  if (isThreatened(ctx, owner, base)) {
    mobilizeDefense(ctx, owner, base, aiRobots);
    return;
  }

  const idle = aiRobots.filter((e) => e.script!.programId === TaskType.Idle);
  if (idle.length === 0) return;

  const posture = forcePosture(ctx, owner);

  const bombers = idle.filter((e) => e.weaponType === WeaponType.Bomb);
  for (const bomber of bombers) {
    // Outnumbered: keep the kamikaze home as an extra defender rather than
    // spending it on a run the AI may not survive to benefit from.
    if (posture === 'defensive') bomber.script = makeGuard(guardPost(base, ctx.rng));
    else assignKamikaze(ctx, bomber);
  }
  const rest = idle.filter((e) => e.weaponType !== WeaponType.Bomb);

  const guardQuota =
    posture === 'defensive' ? gameConfig.ai.guardQuota + gameConfig.ai.defensiveGuardBonus : gameConfig.ai.guardQuota;

  let guards = aiRobots.filter((e) => e.script!.programId === TaskType.Guard).length;
  const staged: Entity[] = [];
  for (const robot of rest) {
    if (guards < guardQuota) {
      robot.script = makeGuard(guardPost(base, ctx.rng));
      guards += 1;
    } else {
      staged.push(robot); // hold near base until a wave forms (or posture calls for one)
    }
  }

  if (posture === 'defensive') return; // significantly outnumbered — hold everything back, no offensive wave

  if (posture === 'offensive' && staged.length > 0) {
    // Significantly ahead — press it now instead of waiting for a full wave to form.
    for (const robot of staged) robot.script = makeAttackBase();
    return;
  }

  if (state.groupTarget <= 0) state.groupTarget = rollAttackGroup(ctx.rng);
  if (staged.length >= state.groupTarget) {
    for (const robot of staged.slice(0, state.groupTarget)) robot.script = makeAttackBase();
    state.groupTarget = rollAttackGroup(ctx.rng); // size the next wave
  }
}

type ForcePosture = 'offensive' | 'defensive' | 'balanced';

/**
 * Compares this bot's living robots against its **strongest single** rival
 * (whole map — same omniscience `isThreatened` already uses) to decide whether
 * to press an advantage, turtle up, or play the usual staged-wave game. Only a
 * significant edge (`forceAdvantageMargin`) moves it off `balanced`, so small
 * fluctuations don't cause posture to flip-flop every tick.
 *
 * Strongest rival rather than *all* rivals combined: in a four-way match every
 * side is outnumbered by the rest of the table, so summing would leave every
 * bot permanently turtled and nobody would ever attack.
 */
function forcePosture(ctx: GameContext, owner: Owner): ForcePosture {
  const mine = livingRobotCount(ctx, (e) => e.owner === owner);
  const rival = strongestRivalCount(ctx, owner);
  const margin = gameConfig.ai.forceAdvantageMargin;
  if (mine - rival >= margin) return 'offensive';
  if (rival - mine >= margin) return 'defensive';
  return 'balanced';
}

/** Living robot count of whichever enemy side currently fields the most. */
function strongestRivalCount(ctx: GameContext, owner: Owner): number {
  let most = 0;
  for (const side of ctx.roster) {
    if (!isEnemy(owner, side.owner)) continue;
    most = Math.max(most, livingRobotCount(ctx, (e) => e.owner === side.owner));
  }
  return most;
}

function livingRobotCount(ctx: GameContext, match: (e: Entity) => boolean): number {
  return ctx.world.with('robot').entities.filter((e) => (e.hp ?? 0) > 0 && match(e)).length;
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
function mobilizeDefense(ctx: GameContext, owner: Owner, base: Entity, aiRobots: Entity[]): void {
  const massRush = nearbyEnemyCount(ctx, owner, base) >= gameConfig.ai.massRushThreshold;
  for (const robot of aiRobots) {
    if (robot.weaponType === WeaponType.Ew) continue; // unarmed — nothing to fight with, stays put
    const programId = robot.script!.programId;
    if (programId === TaskType.AttackRobots) continue; // already mobilized — don't reset its blackboard/roamTarget
    const homeBound = programId === TaskType.Idle || programId === TaskType.Guard;
    if (massRush || homeBound) robot.script = makeAttackRobots();
  }
}

function isThreatened(ctx: GameContext, owner: Owner, base: Entity): boolean {
  return nearbyEnemyCount(ctx, owner, base) > 0;
}

/**
 * Living hostile robots within `threatRange` of the base, right now — from any
 * side, so a bot defends itself against another bot just as it would against
 * the player.
 */
function nearbyEnemyCount(ctx: GameContext, owner: Owner, base: Entity): number {
  const bp = base.position!;
  return ctx.world
    .with('robot', 'position')
    .entities.filter(
      (r) =>
        isEnemy(owner, r.owner) &&
        (r.hp ?? 0) > 0 &&
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
