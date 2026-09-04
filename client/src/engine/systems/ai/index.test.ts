import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnRobot } from '../../ecs/factory';
import { createRng } from '../../../utils/rng';
import { aiSystem } from './index';
import { productionSystem } from '../production';
import { makeCtx } from '../testkit';

const aiRobots = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.world.with('robot', 'script').entities.filter((e) => e.owner === Owner.AI);

describe('aiSystem — production preset', () => {
  it('builds the preset in order, with a kamikaze bomb as every 10th unit', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    // Pre-seed the guaranteed EW jammer so `ensureEwRobot` doesn't interleave an
    // extra build into this preset-cadence test — that behaviour is covered below.
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Wheels,
      WeaponType.Ew,
    );

    for (let i = 0; i < 10; i++) {
      aiSystem(ctx, 100); // enqueue one (timer bypassed)
      productionSystem(ctx, 100); // build it
    }
    aiSystem(ctx, 100); // one more pass so the freshly-built (Idle) bomb gets a kamikaze order

    const built = ctx.world
      .with('robot')
      .entities.filter((e) => e.owner === Owner.AI && e.weaponType !== WeaponType.Ew)
      // Sorted into build order explicitly. A query's iteration order is a
      // miniplex implementation detail — a *freshly created* query seeds itself
      // by walking the world backwards, so whether this array comes out in spawn
      // order depends on whether some system happened to create the same query
      // earlier. Ids are assigned in spawn order, so they are the real thing the
      // assertions below are about.
      .sort((a, b) => Number(a.id.split('_')[1]) - Number(b.id.split('_')[1]));
    expect(built.length).toBe(10);
    // The first nine are ordinary combat robots...
    expect(built.slice(0, 9).every((r) => r.weaponType !== WeaponType.Bomb)).toBe(true);
    // ...the tenth is a bomb, sent at a cluster or the base (see `assignKamikaze`).
    expect(built[9].weaponType).toBe(WeaponType.Bomb);
    expect([TaskType.AttackBase, TaskType.AttackTarget]).toContain(built[9].script!.programId);
  });
});

describe('aiSystem — EW guarantee', () => {
  it('queues a wheels+EW guard when the AI has none', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);

    aiSystem(ctx, 0);

    expect(base.production!.queue.some((o) => o.weapon === WeaponType.Ew && o.chassis === ChassisType.Wheels)).toBe(
      true,
    );
  });

  it('does not queue another once one is alive', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Wheels,
      WeaponType.Ew,
    );

    aiSystem(ctx, 0);

    expect(base.production!.queue.some((o) => o.weapon === WeaponType.Ew)).toBe(false);
  });

  it('replaces it once the jammer dies', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const ew = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Wheels,
      WeaponType.Ew,
    );
    ew.hp = 0;

    aiSystem(ctx, 0);

    expect(base.production!.queue.some((o) => o.weapon === WeaponType.Ew)).toBe(true);
  });

  it('queues one it cannot yet afford, and lets the queue wait', () => {
    // The bot orders on exactly the player's rule: stating the intent is free,
    // and `productionSystem` charges when the order reaches the head. Ordering
    // while broke is therefore a queued order and an untouched bank, not a skip.
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.resources.ai = 0;

    aiSystem(ctx, 0);

    expect(base.production!.queue.length).toBe(1);
    expect(base.production!.funded).toBe(false);
    expect(ctx.resources.ai).toBe(0);
  });
});

describe('aiSystem — the bot pays for a build exactly once', () => {
  const ewGuard = gameConfig.economy.chassisCost.wheels + gameConfig.economy.weaponCost.ew;

  /**
   * Regression guard for a double charge that survived a commit unnoticed: the
   * bot used to pay at `queue.push` *and* again at the head of the queue, so
   * every order cost twice its price and the bot's real economy was half of what
   * `gameConfig.difficulty` claimed. `productionSystem` is the only place money
   * moves — for the bot as for the player.
   */
  it('moves the bank by the build cost, not twice it', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.resources.ai = 1000;

    // dt 0 keeps the preset cadence asleep, so the EW guarantee is the only order.
    aiSystem(ctx, 0);
    expect(base.production!.queue.length).toBe(1);
    expect(ctx.resources.ai).toBe(1000); // ordering is free

    productionSystem(ctx, 100); // charge at the head, then build it
    expect(ctx.resources.ai).toBe(1000 - ewGuard);
  });

  it('keeps the build cadence moving while broke, instead of stalling on a step', () => {
    // The affordability check used to return before `buildStep` advanced, so a
    // bot that could not cover the step in front retried that same step forever.
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    // Pre-seed the jammer so `ensureEwRobot` doesn't add orders of its own.
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Wheels,
      WeaponType.Ew,
    );
    ctx.resources.ai = 0;

    for (let i = 0; i < 3; i++) aiSystem(ctx, 100);

    expect(ctx.ai[Owner.AI]!.buildStep).toBe(3);
    expect(base.production!.queue.length).toBe(3);
    expect(ctx.resources.ai).toBe(0);
  });
});

describe('aiSystem — defense mobilization', () => {
  function spawnPlayerRobotsNear(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    const robots = [];
    for (let i = 0; i < count; i++) {
      robots.push(
        spawnRobot(
          ctx.world,
          Owner.Player,
          { x: base.position!.x + 50 + i, y: base.position!.y + 50 },
          ChassisType.Tracks,
          WeaponType.Cannon,
        ),
      );
    }
    return robots;
  }

  it('puts a home-based unit on base defence when a raider turns up', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const guard = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    guard.script = {
      programId: TaskType.Guard,
      blackboard: { guardPos: { x: guard.position!.x, y: guard.position!.y } },
    };
    spawnPlayerRobotsNear(ctx, base, 1);

    aiSystem(ctx, 0);

    // Not `AttackRobots`: nothing in the engine ends a task, so hunting one
    // raider across the map would cost the base a defender permanently.
    expect(guard.script!.programId).toBe(TaskType.DefendBase);
  });

  it('mobilizes even when no AI robot is idle', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const guard = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    guard.script = { programId: TaskType.Guard, blackboard: {} };
    spawnPlayerRobotsNear(ctx, base, 1);

    aiSystem(ctx, 0);

    expect(guard.script!.programId).toBe(TaskType.DefendBase);
  });

  it('pulls in a group that is still gathering, but not one that has set off', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const gathering = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    gathering.script = { programId: TaskType.GroupAttack, blackboard: { committed: false } };
    const departed = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 500, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    departed.script = { programId: TaskType.GroupAttack, blackboard: { committed: true } };
    spawnPlayerRobotsNear(ctx, base, 1);

    aiSystem(ctx, 0);

    expect(gathering.script!.programId).toBe(TaskType.DefendBase);
    expect(departed.script!.programId).toBe(TaskType.GroupAttack); // already on its way
  });

  it('leaves an active attacker alone below the mass-rush threshold', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const attacker = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 500, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    attacker.script = { programId: TaskType.AttackBase, blackboard: {} };
    spawnPlayerRobotsNear(ctx, base, gameConfig.ai.massRushThreshold - 1);

    aiSystem(ctx, 0);

    expect(attacker.script!.programId).toBe(TaskType.AttackBase);
  });

  it('recalls an active attacker once the rush is big enough', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const attacker = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 500, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    attacker.script = { programId: TaskType.AttackBase, blackboard: {} };
    spawnPlayerRobotsNear(ctx, base, gameConfig.ai.massRushThreshold);

    aiSystem(ctx, 0);

    expect(attacker.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('does not reset the blackboard of a robot already mobilized', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const fighter = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 40, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    const roamTarget = { x: 111, y: 222 };
    fighter.script = { programId: TaskType.AttackRobots, blackboard: { roamTarget } };
    spawnPlayerRobotsNear(ctx, base, 1);

    aiSystem(ctx, 0);

    expect(fighter.script!.programId).toBe(TaskType.AttackRobots);
    expect(fighter.script!.blackboard.roamTarget).toEqual(roamTarget);
  });

  it('never sends the EW jammer into combat, even during a mass rush', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const ew = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 40, y: base.position!.y },
      ChassisType.Wheels,
      WeaponType.Ew,
    );
    ew.script = { programId: TaskType.Guard, blackboard: {} };
    spawnPlayerRobotsNear(ctx, base, gameConfig.ai.massRushThreshold);

    aiSystem(ctx, 0);

    expect(ew.script!.programId).toBe(TaskType.Guard);
  });
});

describe('aiSystem — kamikaze targeting', () => {
  function seedBomber(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>) {
    return spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Tracks,
      WeaponType.Bomb,
    );
  }

  it('rushes the base when no enemy cluster is known', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0; // isolate assignment from production
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    seedBomber(ctx, base);

    aiSystem(ctx, 0);

    const bomber = aiRobots(ctx).find((r) => r.weaponType === WeaponType.Bomb)!;
    expect(bomber.script!.programId).toBe(TaskType.AttackBase);
  });

  it('rushes the base when the known enemy cluster is below the threshold', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const bomber = seedBomber(ctx, base);
    // A single known enemy robot, alone — not a "cluster" by any threshold.
    const foe = spawnRobot(ctx.world, Owner.Player, { x: 900, y: 900 }, ChassisType.Tracks, WeaponType.Cannon);
    ctx.intel.ai.visibleRobotIds = new Set([foe.id]);

    aiSystem(ctx, 0);

    expect(bomber.script!.programId).toBe(TaskType.AttackBase);
  });

  it('can send the kamikaze at a big enough known cluster instead of the base', () => {
    // The cluster/base split is a coin flip (`kamikazeClusterChance`), so try a
    // spread of seeds and require at least one to pick the cluster — this checks
    // the code path can actually trigger without pinning to one exact RNG draw.
    let pickedCluster = false;
    for (let seed = 1; seed <= 30 && !pickedCluster; seed++) {
      const ctx = makeCtx(seed);
      ctx.rng = createRng(seed);
      ctx.resources.ai = 0;
      const base = spawnBase(ctx.world, Owner.AI, 33, 4);
      const bomber = seedBomber(ctx, base);
      const cx = base.position!.x + 300;
      const cy = base.position!.y + 300;
      const foes = [
        spawnRobot(ctx.world, Owner.Player, { x: cx, y: cy }, ChassisType.Tracks, WeaponType.Cannon),
        spawnRobot(ctx.world, Owner.Player, { x: cx + 10, y: cy }, ChassisType.Tracks, WeaponType.Cannon),
        spawnRobot(ctx.world, Owner.Player, { x: cx - 10, y: cy }, ChassisType.Tracks, WeaponType.Cannon),
      ];
      ctx.intel.ai.visibleRobotIds = new Set(foes.map((f) => f.id));

      aiSystem(ctx, 0);

      if (bomber.script!.programId === TaskType.AttackTarget) pickedCluster = true;
    }
    expect(pickedCluster).toBe(true);
  });
});

describe('aiSystem — group attacks', () => {
  function seedIdleAi(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    for (let i = 0; i < count; i++) {
      spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x, y: base.position!.y + 40 + i * 4 },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
    }
  }

  // Far from the AI base (well outside threatRange) so these don't trip
  // `isThreatened` — only here to keep `forcePosture` at 'balanced' so these
  // tests exercise the assignment split on its own (posture behaviour has its
  // own describe block below).
  function matchAiCount(ctx: ReturnType<typeof makeCtx>, count: number) {
    for (let i = 0; i < count; i++) {
      spawnRobot(ctx.world, Owner.Player, { x: 40 + i, y: 40 }, ChassisType.Tracks, WeaponType.Cannon);
    }
  }

  it('fills the defence quota, then puts everything else on Group Attack', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0; // starve production so only assignment runs
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const count = gameConfig.ai.guardQuota + 3;
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.DefendBase)).toBe(gameConfig.ai.guardQuota);
    expect(by(TaskType.GroupAttack)).toBe(3);
    expect(by(TaskType.Idle)).toBe(0);
  });

  it('never leaves a robot idle, whatever the force ratio', () => {
    // The original bug: units over the quota were parked on Idle and released
    // only when the pool reached a wave size rolled as high as 10 — which the
    // robot cap, the quota, the EW jammer and the dew hull made unreachable, so
    // they idled at base for the rest of the match. Nothing may sit on Idle now.
    for (const seed of [1, 2, 3]) {
      const ctx = makeCtx(seed);
      spawnBase(ctx.world, Owner.AI, 33, 4);
      spawnBase(ctx.world, Owner.Player, 4, 33);

      for (let tick = 0; tick < 400; tick++) {
        aiSystem(ctx, 0.5);
        productionSystem(ctx, 0.5);
        const idle = aiRobots(ctx).filter((r) => (r.hp ?? 0) > 0 && r.script!.programId === TaskType.Idle);
        expect(idle).toHaveLength(0);
      }
      // ...and the run actually built an army, so the assertion had something to bite on.
      expect(aiRobots(ctx).length).toBeGreaterThan(gameConfig.ai.guardQuota);
    }
  });

  it('keeps forming groups at the robot cap — the deadlock this replaced', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    // A full army: under the old staged-wave logic a high roll could never be
    // met out of this, and the surplus stood idle forever.
    const count = gameConfig.production.maxRobots;
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);

    aiSystem(ctx, 100);

    const attackers = aiRobots(ctx).filter((r) => r.script!.programId === TaskType.GroupAttack);
    expect(attackers.length).toBe(count - gameConfig.ai.guardQuota);
  });

  it('keeps the same robots on the defence line instead of churning the quota', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const count = gameConfig.ai.guardQuota + 2;
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);

    aiSystem(ctx, 100);
    const first = aiRobots(ctx)
      .filter((r) => r.script!.programId === TaskType.DefendBase)
      .map((r) => r.id);
    // Give them a patrol leg in progress, which a needless reassignment would wipe.
    for (const r of aiRobots(ctx)) {
      if (r.script!.programId === TaskType.DefendBase) r.script!.blackboard.roamTarget = { x: 1, y: 2 };
    }

    aiSystem(ctx, 100);
    const second = aiRobots(ctx)
      .filter((r) => r.script!.programId === TaskType.DefendBase)
      .map((r) => r.id);

    expect(second).toEqual(first);
    for (const r of aiRobots(ctx)) {
      if (r.script!.programId === TaskType.DefendBase) {
        expect(r.script!.blackboard.roamTarget).toEqual({ x: 1, y: 2 });
      }
    }
  });
});

describe('aiSystem — force posture', () => {
  function spawnDistantPlayerRobots(ctx: ReturnType<typeof makeCtx>, count: number) {
    const robots = [];
    for (let i = 0; i < count; i++) {
      robots.push(spawnRobot(ctx.world, Owner.Player, { x: 40 + i, y: 40 }, ChassisType.Tracks, WeaponType.Cannon));
    }
    return robots;
  }

  function seedIdleAi(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    const robots = [];
    for (let i = 0; i < count; i++) {
      robots.push(
        spawnRobot(
          ctx.world,
          Owner.AI,
          { x: base.position!.x, y: base.position!.y + 40 + i * 4 },
          ChassisType.Tracks,
          WeaponType.Cannon,
        ),
      );
    }
    return robots;
  }

  it('presses the attack immediately when significantly ahead, without waiting for a group', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    // One unit over the quota, no player robots at all: it goes straight out
    // rather than waiting for a group that a lopsided fight doesn't need.
    seedIdleAi(ctx, base, gameConfig.ai.guardQuota + 1);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    expect(robots.filter((r) => r.script!.programId === TaskType.AttackBase).length).toBe(1);
    expect(robots.filter((r) => r.script!.programId === TaskType.GroupAttack).length).toBe(0);
    expect(robots.filter((r) => r.script!.programId === TaskType.Idle).length).toBe(0);
  });

  it('turtles up and expands the defence line when significantly outnumbered', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const count = gameConfig.ai.guardQuota + gameConfig.ai.defensiveGuardBonus + 2;
    seedIdleAi(ctx, base, count);
    spawnDistantPlayerRobots(ctx, count + gameConfig.ai.forceAdvantageMargin);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.DefendBase)).toBe(count); // the surplus holds too, nobody is sent out
    expect(by(TaskType.AttackBase)).toBe(0);
    expect(by(TaskType.GroupAttack)).toBe(0);
  });

  it('keeps a kamikaze at home instead of sending it off when significantly outnumbered', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const bomber = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Tracks,
      WeaponType.Bomb,
    );
    spawnDistantPlayerRobots(ctx, gameConfig.ai.forceAdvantageMargin + 1); // AI has 1 robot, player has margin+1 more

    aiSystem(ctx, 100);

    expect(bomber.script!.programId).toBe(TaskType.DefendBase);
  });
});

describe('aiSystem — directed-energy escort discipline', () => {
  /** An AI base plus one dew hull sitting next to it, and a matched player force. */
  function seedDew(ctx: ReturnType<typeof makeCtx>) {
    ctx.resources.ai = 0; // starve production so only assignment runs
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const dew = spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x, y: base.position!.y + 40 },
      ChassisType.Wheels,
      WeaponType.Dew,
    );
    return { base, dew };
  }

  /** `n` AI cannons already marching on the enemy base — the escort a dew waits for. */
  function seedEscort(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, n: number) {
    for (let i = 0; i < n; i++) {
      const r = spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x + 60 + i * 4, y: base.position!.y },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
      r.script = { programId: TaskType.AttackBase, blackboard: {} };
    }
  }

  it('holds a lone dew at home rather than sending it off to die for one freeze', () => {
    const ctx = makeCtx(1);
    const { dew } = seedDew(ctx);

    aiSystem(ctx, 100);

    expect(dew.script!.programId).toBe(TaskType.DefendBase);
  });

  it('still holds it when the push is too thin to escort it', () => {
    const ctx = makeCtx(1);
    const { base, dew } = seedDew(ctx);
    seedEscort(ctx, base, gameConfig.ai.dewEscortMin - 1);

    aiSystem(ctx, 100);

    expect(dew.script!.programId).toBe(TaskType.DefendBase);
  });

  it('does not count unarmed hulls as escort — a dew never escorts a dew', () => {
    const ctx = makeCtx(1);
    const { base, dew } = seedDew(ctx);
    for (let i = 0; i < gameConfig.ai.dewEscortMin; i++) {
      const other = spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x + 60 + i * 4, y: base.position!.y },
        ChassisType.Wheels,
        WeaponType.Dew,
      );
      other.script = { programId: TaskType.AttackBase, blackboard: {} };
    }

    aiSystem(ctx, 100);

    expect(dew.script!.programId).toBe(TaskType.DefendBase);
  });

  it('sends a loaded dew up with a real push', () => {
    const ctx = makeCtx(1);
    const { base, dew } = seedDew(ctx);
    seedEscort(ctx, base, gameConfig.ai.dewEscortMin);

    aiSystem(ctx, 100);

    expect(dew.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('drops it out of the vanguard the moment it has fired, then brings it back', () => {
    const ctx = makeCtx(1);
    const { base, dew } = seedDew(ctx);
    seedEscort(ctx, base, gameConfig.ai.dewEscortMin);

    aiSystem(ctx, 100);
    expect(dew.script!.programId).toBe(TaskType.AttackRobots);

    dew.weapon!.cooldownLeft = gameConfig.robots.weapons.dew.cooldown; // it just took its shot
    aiSystem(ctx, 100);
    expect(dew.script!.programId).toBe(TaskType.Overwatch); // trails the group while reloading

    dew.weapon!.cooldownLeft = 0; // reloaded
    aiSystem(ctx, 100);
    expect(dew.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('never lets a dew make up the numbers of an attack group', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);

    // The defence quota is already filled by armed hulls, so it can't absorb
    // anything below and muddy what this test is about.
    for (let i = 0; i < gameConfig.ai.guardQuota; i++) {
      const g = spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x, y: base.position!.y + 40 + i * 4 },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
      g.script = { programId: TaskType.DefendBase, blackboard: {} };
    }
    // Three bodies left over — a full group by headcount, but two of them are
    // dew hulls that between them can't destroy anything. `positionDewUnits`
    // owns those, so only the one cannon may end up waiting for a group.
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 20, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    for (let i = 0; i < 2; i++) {
      spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x + 20, y: base.position!.y + 40 + i * 4 },
        ChassisType.Wheels,
        WeaponType.Dew,
      );
    }
    // Matched player force, far away: keeps `forcePosture` at 'balanced' and out
    // of `threatRange` (which would mobilize instead).
    for (let i = 0; i < 6; i++) {
      spawnRobot(ctx.world, Owner.Player, { x: 40 + i * 4, y: 40 }, ChassisType.Tracks, WeaponType.Cannon);
    }

    aiSystem(ctx, 100);

    const grouping = aiRobots(ctx).filter((r) => r.script!.programId === TaskType.GroupAttack);
    expect(grouping).toHaveLength(1);
    expect(grouping[0].weaponType).toBe(WeaponType.Cannon);
  });
});

describe('aiSystem — the FPV interceptor', () => {
  /** A bot base with money on hand, so the only thing gating a build is policy. */
  function botBase(ctx: ReturnType<typeof makeCtx>) {
    ctx.resources.ai = 1000;
    return spawnBase(ctx.world, Owner.AI, 33, 4);
  }

  /** One player kamikaze somewhere on the map, spotted or not. */
  function kamikaze(ctx: ReturnType<typeof makeCtx>) {
    return spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Wheels, WeaponType.Bomb);
  }

  function spotted(ctx: ReturnType<typeof makeCtx>, robots: { id: string }[]) {
    ctx.intel[Owner.AI].visibleRobotIds = new Set(robots.map((r) => r.id));
  }

  const carriers = (base: ReturnType<typeof spawnBase>) =>
    base.production!.queue.filter((o) => o.weapon === WeaponType.Fpv);

  it('queues one the moment a kamikaze is spotted', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, [kamikaze(ctx)]);

    aiSystem(ctx, 0);

    expect(carriers(base)).toHaveLength(1);
  });

  it('builds none in a match with no kamikaze in it', () => {
    // The whole reason this is reactive rather than standing like the jammer: a
    // launcher that only ever shells is 140 resources off every other match.
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, [spawnRobot(ctx.world, Owner.Player, { x: 600, y: 600 }, ChassisType.Tracks, WeaponType.Cannon)]);

    aiSystem(ctx, 0);

    expect(carriers(base)).toHaveLength(0);
  });

  it('does not answer a kamikaze it has not seen', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    kamikaze(ctx); // present, unseen

    aiSystem(ctx, 0);

    expect(carriers(base)).toHaveLength(0);
  });

  it('queues exactly one, however many ticks the threat stands there', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, [kamikaze(ctx)]);

    for (let i = 0; i < 5; i++) aiSystem(ctx, 0);

    expect(carriers(base)).toHaveLength(1);
  });

  it('leaves it at one when a carrier is already on the field — a jammer beats two as easily as one', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spawnRobot(ctx.world, Owner.AI, { x: 900, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    spotted(ctx, [kamikaze(ctx)]);

    aiSystem(ctx, 0);

    expect(carriers(base)).toHaveLength(0);
  });

  it('jumps the queue, but never displaces the order being built', () => {
    // Same rule as the player's own queue jump: the head has been paid for, and
    // its progress belongs to it.
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    const head = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    base.production!.queue.push(head, { chassis: ChassisType.Legs, weapon: WeaponType.Missiles });
    base.production!.funded = true;
    spotted(ctx, [kamikaze(ctx)]);

    aiSystem(ctx, 0);

    expect(base.production!.queue[0]).toBe(head);
    expect(base.production!.queue[1].weapon).toBe(WeaponType.Fpv);
  });

  it('goes to the very front when nothing is part-built', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    base.production!.queue.push({ chassis: ChassisType.Tracks, weapon: WeaponType.Cannon });
    spotted(ctx, [kamikaze(ctx)]);

    aiSystem(ctx, 0);

    expect(base.production!.queue[0].weapon).toBe(WeaponType.Fpv);
  });
});

describe('aiSystem — the energy dome', () => {
  /** A bot base with an empty bank, so nothing here trips the production path. */
  function botBase(ctx: ReturnType<typeof makeCtx>) {
    ctx.resources.ai = 0;
    return spawnBase(ctx.world, Owner.AI, 33, 4);
  }

  /** `count` player robots inside the bot's `threatRange`, spotted or not. */
  function raiders(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(
        spawnRobot(
          ctx.world,
          Owner.Player,
          { x: base.position!.x + 60 + i, y: base.position!.y + 60 },
          ChassisType.Tracks,
          WeaponType.Cannon,
        ),
      );
    }
    return out;
  }

  /** `count` player kamikazes on the bot's doorstep, inside the defence radius. */
  function kamikazes(ctx: ReturnType<typeof makeCtx>, base: ReturnType<typeof spawnBase>, count: number) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(
        spawnRobot(
          ctx.world,
          Owner.Player,
          { x: base.position!.x + 100 + i, y: base.position!.y + 100 },
          ChassisType.Wheels,
          WeaponType.Bomb,
        ),
      );
    }
    return out;
  }

  /** Marks `robots` as spotted by the bot, which `visionSystem` would normally do. */
  function spotted(ctx: ReturnType<typeof makeCtx>, robots: { id: string }[]) {
    ctx.intel[Owner.AI].visibleRobotIds = new Set(robots.map((r) => r.id));
  }

  it('raises it once the base is chewed below the hp threshold', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    base.hp = base.maxHp! * gameConfig.ai.shieldHpThreshold - 1;

    aiSystem(ctx, 0);

    expect(base.shield).toBeDefined();
  });

  it('raises it for a rush it can actually see', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, raiders(ctx, base, gameConfig.ai.massRushThreshold));

    aiSystem(ctx, 0);

    expect(base.shield).toBeDefined();
  });

  it('does not raise it for a rush it has not spotted — the bot pays for scouting too', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    raiders(ctx, base, gameConfig.ai.massRushThreshold); // present, unseen

    aiSystem(ctx, 0);

    expect(base.shield).toBeUndefined();
  });

  it('holds its fire below the rush threshold', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, raiders(ctx, base, gameConfig.ai.massRushThreshold - 1));

    aiSystem(ctx, 0);

    expect(base.shield).toBeUndefined();
  });

  it('raises it for kamikazes that already add up to the base, long before either older trigger', () => {
    // The hole this closes: two bombs (300 each) end a 600 hp base, and neither the
    // hp threshold (the first leaves it at 50%, above the line) nor the rush count
    // (two is nowhere near five) ever fired. The dome was spent on nothing, every
    // match, and a `wheels` + `bomb` opening simply won.
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    const needed = Math.ceil(base.maxHp! / gameConfig.robots.weapons.bomb.damage);
    spotted(ctx, kamikazes(ctx, base, needed));

    aiSystem(ctx, 0);

    expect(base.hp).toBe(base.maxHp); // not a scratch on it yet, and the dome is up
    expect(base.shield).toBeDefined();
  });

  it('holds it for a burst that does not add up to the base yet', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    const needed = Math.ceil(base.maxHp! / gameConfig.robots.weapons.bomb.damage);
    spotted(ctx, kamikazes(ctx, base, needed - 1));

    aiSystem(ctx, 0);

    expect(base.shield).toBeUndefined();
  });

  it('counts only the kamikazes it has spotted', () => {
    // Same rule as the rush above, and for the same reason: the dome is the one
    // control both sides hold, so a bot must not answer a raid it cannot see while
    // the player's own button stays dark against the same one.
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    kamikazes(ctx, base, 10); // present, unseen

    aiSystem(ctx, 0);

    expect(base.shield).toBeUndefined();
  });

  it('does not count guns toward the burst — only what lands all at once', () => {
    // A cannon takes its 600 hp off over forty seconds of shooting, which is what
    // the hp threshold is for. Reading its `damage` as a burst would spend the dome
    // on the first skirmish that wandered past.
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    spotted(ctx, raiders(ctx, base, gameConfig.ai.massRushThreshold - 1));

    aiSystem(ctx, 0);

    expect(base.shield).toBeUndefined();
  });

  it('never raises a second one', () => {
    const ctx = makeCtx(1);
    const base = botBase(ctx);
    base.hp = 1;

    aiSystem(ctx, 0);
    base.shield!.hp = 10;
    aiSystem(ctx, 0);

    expect(base.shield!.hp).toBe(10);
  });
});
