import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { createRng } from '../../utils/rng';
import { aiSystem } from './ai';
import { productionSystem } from './production';
import { makeCtx } from './testkit';

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
      .entities.filter((e) => e.owner === Owner.AI && e.weaponType !== WeaponType.Ew);
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

  it('does not queue one it cannot afford', () => {
    const ctx = makeCtx(1);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.resources.ai = 0;

    aiSystem(ctx, 0);

    expect(base.production!.queue.length).toBe(0);
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

  it('pulls a Guard into the fight, not just Idle units', () => {
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

    expect(guard.script!.programId).toBe(TaskType.AttackRobots);
  });

  it('mobilizes even when every AI robot is a Guard (no Idle units at all)', () => {
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

    expect(guard.script!.programId).toBe(TaskType.AttackRobots);
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
  // tests exercise the wave-threshold mechanic on its own (posture behaviour
  // has its own describe block below).
  function matchAiCount(ctx: ReturnType<typeof makeCtx>, count: number) {
    for (let i = 0; i < count; i++) {
      spawnRobot(ctx.world, Owner.Player, { x: 40 + i, y: 40 }, ChassisType.Tracks, WeaponType.Cannon);
    }
  }

  it('releases offensive units in a wave once enough have gathered', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0; // starve production so only assignment runs
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai[Owner.AI]!.groupTarget = 3;
    const count = gameConfig.ai.guardQuota + 3;
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.Guard)).toBe(gameConfig.ai.guardQuota);
    expect(by(TaskType.AttackBase)).toBe(3); // a full wave marched off together
    expect(by(TaskType.Idle)).toBe(0);
  });

  it('holds units back (no attack) until the wave size is reached', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai[Owner.AI]!.groupTarget = 3;
    const count = gameConfig.ai.guardQuota + 2; // only 2 staged, below the wave size
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.AttackBase)).toBe(0); // nothing released yet
    expect(by(TaskType.Idle)).toBe(2); // still staged near base
  });

  it('sizes each wave within the configured group range', () => {
    const ctx = makeCtx(3);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai[Owner.AI]!.groupTarget = 0; // force a roll
    const count = gameConfig.ai.guardQuota + gameConfig.ai.attackGroupMax;
    seedIdleAi(ctx, base, count);
    matchAiCount(ctx, count);
    ctx.resources.ai = 0;

    aiSystem(ctx, 100);

    const attackers = aiRobots(ctx).filter((r) => r.script!.programId === TaskType.AttackBase).length;
    expect(attackers).toBeGreaterThanOrEqual(gameConfig.ai.attackGroupMin);
    expect(attackers).toBeLessThanOrEqual(gameConfig.ai.attackGroupMax);
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

  it('presses the attack immediately when significantly ahead, without waiting for a full wave', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai[Owner.AI]!.groupTarget = 10; // would normally hold back until 10 have gathered
    seedIdleAi(ctx, base, gameConfig.ai.guardQuota + 1); // only 1 staged, no player robots at all

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    expect(robots.filter((r) => r.script!.programId === TaskType.AttackBase).length).toBe(1);
    expect(robots.filter((r) => r.script!.programId === TaskType.Idle).length).toBe(0);
  });

  it('turtles up and expands the guard line when significantly outnumbered', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    const count = gameConfig.ai.guardQuota + gameConfig.ai.defensiveGuardBonus + 2;
    seedIdleAi(ctx, base, count);
    spawnDistantPlayerRobots(ctx, count + gameConfig.ai.forceAdvantageMargin);

    aiSystem(ctx, 100);

    const robots = aiRobots(ctx);
    const by = (t: TaskType) => robots.filter((r) => r.script!.programId === t).length;
    expect(by(TaskType.Guard)).toBe(gameConfig.ai.guardQuota + gameConfig.ai.defensiveGuardBonus);
    expect(by(TaskType.AttackBase)).toBe(0);
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

    expect(bomber.script!.programId).toBe(TaskType.Guard);
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

    expect(dew.script!.programId).toBe(TaskType.Guard);
  });

  it('still holds it when the push is too thin to escort it', () => {
    const ctx = makeCtx(1);
    const { base, dew } = seedDew(ctx);
    seedEscort(ctx, base, gameConfig.ai.dewEscortMin - 1);

    aiSystem(ctx, 100);

    expect(dew.script!.programId).toBe(TaskType.Guard);
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

    expect(dew.script!.programId).toBe(TaskType.Guard);
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

  it('never lets a dew make up the numbers of an attack wave', () => {
    const ctx = makeCtx(1);
    ctx.resources.ai = 0;
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    ctx.ai[Owner.AI]!.groupTarget = 3;

    // The guard quota is already filled by armed hulls, so it can't absorb
    // anything below and muddy what this test is about.
    for (let i = 0; i < gameConfig.ai.guardQuota; i++) {
      const g = spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x, y: base.position!.y + 40 + i * 4 },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
      g.script = { programId: TaskType.Guard, blackboard: {} };
    }
    // Three bodies left over — a full wave by headcount, but two of them are dew
    // hulls that between them can't destroy anything. No wave may form.
    spawnRobot(ctx.world, Owner.AI, { x: base.position!.x + 20, y: base.position!.y }, ChassisType.Tracks, WeaponType.Cannon);
    for (let i = 0; i < 2; i++) {
      spawnRobot(
        ctx.world,
        Owner.AI,
        { x: base.position!.x + 20, y: base.position!.y + 40 + i * 4 },
        ChassisType.Wheels,
        WeaponType.Dew,
      );
    }
    // Matched player force, far away: keeps `forcePosture` at 'balanced' (which
    // waits for a wave) and out of `threatRange` (which would mobilize instead).
    for (let i = 0; i < 6; i++) {
      spawnRobot(ctx.world, Owner.Player, { x: 40 + i * 4, y: 40 }, ChassisType.Tracks, WeaponType.Cannon);
    }

    aiSystem(ctx, 100);

    expect(aiRobots(ctx).filter((r) => r.script!.programId === TaskType.AttackBase).length).toBe(0);
  });
});
