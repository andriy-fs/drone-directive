import { getBuildPreset } from '../../config/buildPresets';
import { gameConfig } from '../../config/gameConfig';
import {
  BuildPresetType,
  ChassisType,
  Controller,
  TaskType,
  WeaponType,
  type Owner,
} from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { AiState, GameContext } from '../game/context';
import {
  makeAttackBase,
  makeAttackRobots,
  makeAttackTarget,
  makeDefendBase,
  makeGuard,
  makeGroupAttack,
  scriptForTask,
} from '../tasks/taskDefinitions';
import { pilotDrone } from './aiDrone';
import { canRaiseShield, raiseShield } from './shield';
import { isDisabled } from './status';
import { isAdvancing } from './task';
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
 * One bot's turn: resource-gated escalating production off a build preset, task
 * assignment (defence quota → everything else into a gathering attack group →
 * intercept threats), then flying its observer drone. Recomputed from live counts.
 *
 * **A bot robot is never left on `Idle`.** Idle is a passive program — it only
 * ever shoots back at whoever already hit it, and only for the length of the
 * under-fire window — so a unit parked on it is a discount target that also
 * contributes nothing. `DefendBase` is the bot's waiting state instead, and
 * `sweepIdle` at the end is the structural guarantee: whatever route a unit took
 * to get here, it does not end this tick idle.
 */
function runBot(ctx: GameContext, owner: Owner, state: AiState, dt: number): void {
  // Ahead of the base check: a side whose base has fallen still has a drone in
  // the air for a moment, and leaving a stale `dir` on it would have the wreck
  // of a match fly on by itself.
  pilotDrone(ctx, owner, state);

  const base = ctx.world
    .with('base', 'position', 'production')
    .entities.find((e) => e.owner === owner && (e.hp ?? 0) > 0);
  if (!base) return;

  maybeRaiseShield(ctx, owner, base);
  ensureFactoryDefault(base);
  ensureEwRobot(ctx, owner, base);
  updateProduction(ctx, owner, state, base, dt);
  // Ahead of the generic assignment: `dew` hulls are governed by their own rule
  // for the whole match, not just while waiting, so they must be off the table
  // before groups are formed out of whatever is standing around.
  positionDewUnits(ctx, owner);
  positionFpvUnits(ctx, owner);
  assignUnits(ctx, owner, base);
  sweepIdle(ctx, owner);
}

/**
 * The first half of the no-idle rule, applied at the factory door: a bot's units
 * roll out defending the base. `AiAssault` sets no `task` on its steps, so
 * without this a robot built after `assignUnits` has already run for the tick
 * would spend a whole tick on `Idle` before anything picked it up.
 */
function ensureFactoryDefault(base: Entity): void {
  const prod = base.production!;
  if (prod.defaultTask !== TaskType.DefendBase) prod.defaultTask = TaskType.DefendBase;
}

/**
 * The other half: anything that still reached `Idle` — a starter robot from
 * `spawnStarters`, a program refused for its weapon — takes up the base line.
 */
function sweepIdle(ctx: GameContext, owner: Owner): void {
  for (const robot of ctx.world.with('robot', 'script').entities) {
    if (robot.owner !== owner || (robot.hp ?? 0) <= 0) continue;
    if (robot.script!.programId === TaskType.Idle) robot.script = makeDefendBase();
  }
}

/**
 * Where the bot's directed-energy hulls belong, re-decided every tick. They deal
 * no damage, so both halves of this are about not spending one for nothing:
 *
 * - **Never alone.** A lone `dew` freezes one enemy and is then killed by the
 *   rest of them, having traded a whole unit for eight seconds. It only leaves
 *   base once `dewEscortMin` armed robots are already pushing — the escort is
 *   what converts the knock-out into a kill.
 * - **Never in front once it has fired.** With a five-second reload, a `dew`
 *   standing on the firing line after its shot is just a target. While it
 *   reloads it drops to `Overwatch`, which walks it back behind the group's
 *   centroid; when the shot is ready it rejoins the push.
 *
 * Both states are existing programs, so this is bot *policy* only — no new
 * behaviour vocabulary, and nothing here is visible to the player's own units.
 */
function positionDewUnits(ctx: GameContext, owner: Owner): void {
  const units = ctx.world
    .with('robot', 'position', 'script')
    .entities.filter((e) => e.owner === owner && (e.hp ?? 0) > 0 && e.weaponType === WeaponType.Dew);
  if (units.length === 0) return;

  const escorted = advancingCombatCount(ctx, owner) >= gameConfig.ai.dewEscortMin;

  for (const unit of units) {
    if (isDisabled(unit)) continue; // can't take an order until its electronics come back

    const wanted = !escorted
      ? TaskType.DefendBase // no push to join — hold the line at home
      : (unit.weapon?.cooldownLeft ?? 0) > 0
        ? TaskType.Overwatch // just fired: fall back behind the group and reload
        : TaskType.AttackRobots; // loaded: move up with the group and pick a target
    // Only on an actual change: reassigning every tick would wipe the roam
    // blackboard and restart the patrol leg it is part-way through.
    if (unit.script!.programId === wanted) continue;
    unit.script = scriptForTask(unit.position!, wanted);
  }
}

/**
 * Where the bot's FPV carriers belong: standing at home on `Guard`, permanently.
 *
 * They need a rule of their own for the opposite reason `dew` does. A `dew` is
 * governed because it cannot fight alone; a carrier is governed because it never
 * has to move at all — its reach already covers the map, so `Guard` has it hold
 * its post and shell the nearest enemy its side can see, wherever that is. Left
 * to the generic assignment it would be marched out with an attack wave, walking
 * an artillery piece into a firefight it cannot win, or parked on `DefendBase`,
 * where it would only ever shoot at things already on its doorstep — the one
 * place its range is worth nothing.
 *
 * Like `positionDewUnits`, this is bot *policy* built out of existing programs:
 * no new behaviour vocabulary, and nothing here touches the player's own units.
 */
function positionFpvUnits(ctx: GameContext, owner: Owner): void {
  for (const unit of ctx.world.with('robot', 'position', 'script').entities) {
    if (unit.owner !== owner || (unit.hp ?? 0) <= 0 || unit.weaponType !== WeaponType.Fpv) continue;
    if (isDisabled(unit)) continue; // can't take an order until its electronics come back
    // Only on an actual change: re-assigning every tick would re-roll the guard
    // post from the shared rng, which both peers' streams have to agree on.
    if (unit.script!.programId === TaskType.Guard) continue;
    unit.script = makeGuard(unit.position!);
  }
}

/** This side's living robots that can actually kill something and are currently pushing out. */
function advancingCombatCount(ctx: GameContext, owner: Owner): number {
  return ctx.world
    .with('robot', 'script', 'weapon')
    .entities.filter((e) => e.owner === owner && (e.hp ?? 0) > 0 && e.weapon!.damage > 0 && isAdvancing(e)).length;
}

/**
 * Keeps one EW jammer alive/queued at all times — cheapest hull (wheels) since
 * it's a support unit, not a combatant, and it's ordered to defend the base so
 * it stays home instead of wandering off with an attack group. Runs every tick
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

  const order = { chassis: ChassisType.Wheels, weapon: WeaponType.Ew, task: TaskType.DefendBase };
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
 * Assigns programs to the bot's units that are between jobs. Under threat,
 * `mobilizeDefense` takes over. Otherwise behaviour depends on `forcePosture`:
 * outnumbered → turtle up (bigger defence line, no attack group, kamikaze stays
 * home too); significantly ahead → press the advantage immediately instead of
 * waiting for a group; roughly even → fill the defence quota and put everything
 * else on `GroupAttack`, which gathers and sets off on its own.
 *
 * The pool is `Idle` **or `DefendBase`** rather than Idle alone. Idle only shows
 * up for a unit that has just been built, and the bot doesn't leave anything
 * there; the defence line is the standing reserve it actually draws attackers
 * from once the quota is covered.
 *
 * Waves used to be staged here: units over the quota were parked on `Idle` and
 * released once the pool reached a per-wave random size. That size was rolled up
 * to `attackGroupMax` while the robot cap, the defence quota, the EW jammer and
 * the `dew` hull between them capped the pool well below it — so a high roll
 * could never be met and the pool sat at base, idle, for the rest of the match.
 * `GroupAttack` replaces the whole mechanism: the threshold is a fixed small
 * number the program checks itself, so it cannot outrun the force available.
 */
function assignUnits(ctx: GameContext, owner: Owner, base: Entity): void {
  const aiRobots = ctx.world.with('robot', 'position', 'script').entities.filter((e) => e.owner === owner);

  if (isThreatened(ctx, owner, base)) {
    mobilizeDefense(ctx, owner, base, aiRobots);
    return;
  }

  // Knocked-out robots are left out of the *assignment* slices but stay in
  // `aiRobots` for the counts below: they're still force on the board, they just
  // can't be given a new job this tick (and re-rolling their program every tick
  // while they sit there would only churn).
  const available = aiRobots.filter((e) => !isDisabled(e) && REASSIGNABLE.has(e.script!.programId));
  if (available.length === 0) return;

  const posture = forcePosture(ctx, owner);

  for (const bomber of available.filter((e) => e.weaponType === WeaponType.Bomb)) {
    // Outnumbered: keep the kamikaze home as an extra defender rather than
    // spending it on a run the AI may not survive to benefit from.
    if (posture === 'defensive') bomber.script = makeDefendBase();
    else assignKamikaze(ctx, bomber);
  }
  // `dew` is deliberately absent from the group logic: `positionDewUnits` owns
  // it, and counting it toward a group would let one form out of units that
  // between them can't destroy anything. `fpv` is absent for the opposite reason
  // — it is *always* in range of everything, so it would join a group, never
  // actually walk anywhere, and leave the group short of the bodies it counted on.
  const rest = available.filter(
    (e) =>
      e.weaponType !== WeaponType.Bomb && e.weaponType !== WeaponType.Dew && e.weaponType !== WeaponType.Fpv,
  );

  const defenceQuota =
    posture === 'defensive' ? gameConfig.ai.guardQuota + gameConfig.ai.defensiveGuardBonus : gameConfig.ai.guardQuota;

  // Units already holding the line come first, so the quota is filled by the
  // robots that are standing there rather than churning between whoever is free
  // — and a defender that keeps its post keeps its patrol leg with it.
  const onPost = rest.filter((e) => e.script!.programId === TaskType.DefendBase);
  const spare = rest.filter((e) => e.script!.programId !== TaskType.DefendBase);

  let defenders = 0;
  for (const robot of [...onPost, ...spare]) {
    const holding = robot.script!.programId === TaskType.DefendBase;
    if (defenders < defenceQuota) {
      if (!holding) robot.script = makeDefendBase();
      defenders += 1;
      continue;
    }
    // Significantly outnumbered — everything holds; nobody is sent out.
    if (posture === 'defensive') {
      if (!holding) robot.script = makeDefendBase();
      continue;
    }
    // Significantly ahead — press it now instead of waiting for a group to form.
    robot.script = posture === 'offensive' ? makeAttackBase() : makeGroupAttack();
  }
}

/**
 * Programs the bot considers "between jobs" and may reassign: a freshly built
 * unit, and the standing defence line it draws attackers from. Everything else
 * (an attack group, a kamikaze run, an `Overwatch` reload lap) is mid-task.
 */
const REASSIGNABLE = new Set<TaskType>([TaskType.Idle, TaskType.DefendBase]);

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

/**
 * Reassigns AI robots when the base is under threat.
 *
 * Below `massRushThreshold` the home-based units go to `DefendBase`, which
 * intercepts anything inside the base's defence radius and then goes back on
 * post. They used to be switched to `AttackRobots` here, which is a one-way
 * ticket — nothing in the engine ends a task, so a defender sent after one
 * raider hunted robots across the map for the rest of the match and the base was
 * left thinner than before the skirmish.
 *
 * At/above the threshold the AI still recalls everything it can fight with —
 * including units mid-attack — as `AttackRobots`: losing the base outright is
 * worse than losing offensive tempo, and at that point chasing is the point.
 */
function mobilizeDefense(ctx: GameContext, owner: Owner, base: Entity, aiRobots: Entity[]): void {
  const massRush = nearbyEnemyCount(ctx, owner, base) >= gameConfig.ai.massRushThreshold;
  for (const robot of aiRobots) {
    if (isDisabled(robot)) continue; // can't take an order until its electronics come back
    if (robot.weaponType === WeaponType.Ew) continue; // unarmed — nothing to fight with, stays put
    if (robot.weaponType === WeaponType.Dew) continue; // `positionDewUnits` decides where this one stands
    // A launcher already covers the whole map from where it stands, and it never
    // advances (its range makes every target "in reach"), so marching it at a
    // rush would only walk it into one. It keeps whatever program it has.
    if (robot.weaponType === WeaponType.Fpv) continue;
    const programId = robot.script!.programId;

    if (massRush) {
      if (programId !== TaskType.AttackRobots) robot.script = makeAttackRobots(); // don't reset an existing hunt
      continue;
    }
    // A group that has already set off is left alone; one still gathering at
    // base is home-based like any reserve and joins the defence.
    if (isAdvancing(robot)) continue;
    if (programId !== TaskType.DefendBase) robot.script = makeDefendBase();
  }
}

/**
 * The bot's one energy dome, spent on the two situations it cannot recover from
 * otherwise: the base is already being chewed through, or a rush is inside the
 * defence radius in numbers the line will not hold.
 *
 * Counts *known* enemies rather than reusing the omniscient `nearbyEnemyCount`,
 * and that is a deliberate departure. Elsewhere the bot's omniscience is a
 * tuning shortcut for where its units stand; here it would let a bot answer an
 * ambush it has never seen while the player's own button stays dark against the
 * same ambush. The dome is the one control both sides hold, so both pay for
 * scouting.
 *
 * Reads last tick's intel — `aiSystem` runs ahead of `visionSystem` — exactly as
 * `assignKamikaze` does. One tick stale and identical on every peer, which is
 * all determinism asks; do not "fix" it by reordering the pipeline.
 */
function maybeRaiseShield(ctx: GameContext, owner: Owner, base: Entity): void {
  if (!canRaiseShield(base)) return;
  const hurt = (base.hp ?? 0) < (base.maxHp ?? 1) * gameConfig.ai.shieldHpThreshold;
  const swarmed = knownNearbyEnemyCount(ctx, owner, base) >= gameConfig.ai.massRushThreshold;
  if (hurt || swarmed) raiseShield(ctx, base);
}

/** `nearbyEnemyCount`'s intel-limited twin — see `maybeRaiseShield` for why it exists. */
function knownNearbyEnemyCount(ctx: GameContext, owner: Owner, base: Entity): number {
  const bp = base.position!;
  return knownEnemyRobots(ctx, owner).filter(
    (r) => distance(r.position!.x, r.position!.y, bp.x, bp.y) < gameConfig.ai.threatRange,
  ).length;
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

