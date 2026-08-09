import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, RobotState, TaskType, WeaponType } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import { spawnBase, spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { makeAttackTarget, makeDefendBase, makeGroupAttack, makeGuard, makeOverwatch } from '../tasks/taskDefinitions';
import { makeCtx } from './testkit';
import { taskSystem } from './task';
import { movementSystem } from './movement';
import { visionSystem } from './vision';

const DT = gameConfig.fixedDt;

/** Clear the generated terrain so a mountain can't break line of sight. */
function openGround(ctx: GameContext): void {
  const { width, height } = gameConfig.grid;
  ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(false));
}

describe('taskSystem — targeting respects detection', () => {
  it('does not target an undetected (out-of-sight) enemy', () => {
    const ctx = makeCtx(2);
    const hunter = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hunter.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 1200, y: 1200 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    expect(hunter.targetId).toBeUndefined();
  });

  it('targets an enemy once it is detected', () => {
    const ctx = makeCtx(2);
    const hunter = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hunter.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    visionSystem(ctx);
    taskSystem(ctx, DT);
    expect(hunter.targetId).toBe(foe.id);
  });
});

describe('taskSystem — Idle self-defence', () => {
  it('fires back at its attacker while idle, without a chase goal', () => {
    const ctx = makeCtx(2);
    const idle = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    idle.script = { programId: TaskType.Idle, blackboard: {} };
    const attacker = spawnRobot(ctx.world, Owner.AI, { x: 260, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    idle.threat = { attackerId: attacker.id, underFireLeft: gameConfig.behavior.underFireDuration };

    taskSystem(ctx, DT);
    expect(idle.targetId).toBe(attacker.id); // shoots back
    expect(idle.movement!.goal).toBeUndefined(); // but holds position (no chase)
  });

  it('holds with no target when not under fire', () => {
    const ctx = makeCtx(2);
    const idle = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    idle.script = { programId: TaskType.Idle, blackboard: {} };
    taskSystem(ctx, DT);
    expect(idle.targetId).toBeUndefined();
  });
});

describe('taskSystem — AttackTarget (ordered focus-fire)', () => {
  it('focuses the specific ordered target (a base), ignoring a nearer enemy robot', () => {
    const ctx = makeCtx(2);
    const attacker = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const base = spawnBase(ctx.world, Owner.AI, 33, 4);
    spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon); // nearer
    attacker.script = makeAttackTarget(base.id);

    taskSystem(ctx, DT);
    expect(attacker.targetId).toBe(base.id);
  });

  it('stops and drops the target once it is destroyed', () => {
    const ctx = makeCtx(2);
    const attacker = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    attacker.script = makeAttackTarget(foe.id);
    ctx.world.remove(foe);

    taskSystem(ctx, DT);
    expect(attacker.targetId).toBeUndefined();
    expect(attacker.movement!.goal).toBeUndefined();
  });
});

describe('taskSystem — Overwatch (unarmed support role)', () => {
  it('falls back toward its own base the instant it takes fire', () => {
    const ctx = makeCtx(2);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const spotter = spawnRobot(ctx.world, Owner.Player, { x: 500, y: 500 }, ChassisType.Tracks, WeaponType.Radar);
    spotter.script = makeOverwatch();
    const attacker = spawnRobot(ctx.world, Owner.AI, { x: 560, y: 500 }, ChassisType.Tracks, WeaponType.Cannon);
    spotter.threat = { attackerId: attacker.id, underFireLeft: gameConfig.behavior.underFireDuration };

    taskSystem(ctx, DT);
    expect(spotter.movement!.goal).toEqual(base.position);
  });

  it('trails behind an advancing friendly group instead of leading it', () => {
    const ctx = makeCtx(2);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const spotter = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 900 }, ChassisType.Tracks, WeaponType.Radar);
    spotter.script = makeOverwatch();
    const vanguard = spawnRobot(ctx.world, Owner.Player, { x: 900, y: 900 }, ChassisType.Tracks, WeaponType.Cannon);
    vanguard.script = { programId: TaskType.AttackBase, blackboard: {} };

    taskSystem(ctx, DT);

    const goal = spotter.movement!.goal!;
    // Trails at the configured distance behind the vanguard...
    expect(distance(goal.x, goal.y, vanguard.position!.x, vanguard.position!.y)).toBeCloseTo(
      gameConfig.behavior.overwatchTrailDistance,
      5,
    );
    // ...and that trailing point sits closer to home than the vanguard itself (behind it, not beside or ahead).
    expect(distance(goal.x, goal.y, base.position!.x, base.position!.y)).toBeLessThan(
      distance(vanguard.position!.x, vanguard.position!.y, base.position!.x, base.position!.y),
    );
  });

  it('hovers near its own base when no friendly group is advancing', () => {
    const ctx = makeCtx(9);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    const spotter = spawnRobot(ctx.world, Owner.Player, { ...base.position! }, ChassisType.Wheels, WeaponType.Radar);
    spotter.script = makeOverwatch();

    let maxDist = 0;
    for (let i = 0; i < 30 * 15; i++) {
      visionSystem(ctx);
      taskSystem(ctx, DT);
      movementSystem(ctx, DT);
      maxDist = Math.max(
        maxDist,
        distance(spotter.position!.x, spotter.position!.y, base.position!.x, base.position!.y),
      );
    }
    expect(spotter.movement!.state).not.toBe(RobotState.Dead);
    expect(maxDist).toBeLessThanOrEqual(gameConfig.behavior.guardPatrolRadius + gameConfig.grid.tilePx * 2);
  });
});

describe('taskSystem — Guard patrols its post', () => {
  it('roams around the post over time yet stays within the patrol radius', () => {
    const ctx = makeCtx(7);
    const post = { x: 640, y: 640 };
    const guard = spawnRobot(ctx.world, Owner.Player, { ...post }, ChassisType.Wheels, WeaponType.Cannon);
    guard.script = makeGuard(post);

    const seen = new Set<string>();
    let maxDist = 0;
    for (let i = 0; i < 30 * 15; i++) {
      visionSystem(ctx);
      taskSystem(ctx, DT);
      movementSystem(ctx, DT);
      if (i % 30 === 0) seen.add(`${guard.position!.x.toFixed(0)},${guard.position!.y.toFixed(0)}`);
      maxDist = Math.max(maxDist, distance(guard.position!.x, guard.position!.y, post.x, post.y));
    }
    expect(seen.size).toBeGreaterThan(3); // actually moves, not frozen
    expect(guard.movement!.state).not.toBe(RobotState.Dead);
    expect(maxDist).toBeLessThanOrEqual(gameConfig.behavior.guardPatrolRadius + gameConfig.grid.tilePx * 2);
  });
});

describe('taskSystem — DefendBase holds the base, not the robot', () => {
  it('drives out to meet an intruder near the base that is out of its own weapon range', () => {
    const ctx = makeCtx(5);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const bp = base.position!;
    // Posted on the base, cannon (range 120); the intruder sits well beyond that
    // but comfortably inside the base's defence radius (280).
    const defender = spawnRobot(ctx.world, Owner.Player, { x: bp.x, y: bp.y }, ChassisType.Tracks, WeaponType.Cannon);
    defender.script = makeDefendBase();
    const raider = spawnRobot(ctx.world, Owner.AI, { x: bp.x + 220, y: bp.y }, ChassisType.Tracks, WeaponType.Cannon);
    expect(distance(bp.x, bp.y, raider.position!.x, raider.position!.y)).toBeGreaterThan(
      gameConfig.robots.weapons.cannon.range,
    );

    visionSystem(ctx);
    taskSystem(ctx, DT);

    // It closes on the raider — the behaviour Idle and Guard both lack, and the
    // reason an idle robot was free to shoot at from outside its own reach.
    expect(defender.movement!.goal).toBeDefined();
    expect(defender.movement!.goal!.x).toBeCloseTo(raider.position!.x, 0);
    expect(defender.targetId).toBe(raider.id);
  });

  it('ignores an enemy far from the base and patrols instead', () => {
    const ctx = makeCtx(5);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const bp = base.position!;
    const defender = spawnRobot(ctx.world, Owner.Player, { x: bp.x, y: bp.y }, ChassisType.Tracks, WeaponType.Cannon);
    defender.script = makeDefendBase();
    // Outside the defence radius: not this robot's problem.
    spawnRobot(
      ctx.world,
      Owner.AI,
      { x: bp.x + gameConfig.behavior.defendBaseRadius + 120, y: bp.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(defender.targetId).toBeUndefined();
  });

  it('stays within the patrol radius of the base over time', () => {
    const ctx = makeCtx(7);
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const bp = { x: base.position!.x, y: base.position!.y };
    const defender = spawnRobot(ctx.world, Owner.Player, { ...bp }, ChassisType.Wheels, WeaponType.Cannon);
    defender.script = makeDefendBase();

    const seen = new Set<string>();
    let maxDist = 0;
    for (let i = 0; i < 30 * 15; i++) {
      visionSystem(ctx);
      taskSystem(ctx, DT);
      movementSystem(ctx, DT);
      if (i % 30 === 0) seen.add(`${defender.position!.x.toFixed(0)},${defender.position!.y.toFixed(0)}`);
      maxDist = Math.max(maxDist, distance(defender.position!.x, defender.position!.y, bp.x, bp.y));
    }
    expect(seen.size).toBeGreaterThan(3); // actually moves, not frozen
    expect(maxDist).toBeLessThanOrEqual(gameConfig.behavior.defendPatrolRadius + gameConfig.grid.tilePx * 2);
  });

  it('does not send an unarmed hull at an intruder — it has nothing to intercept with', () => {
    const ctx = makeCtx(5);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const bp = base.position!;
    const radar = spawnRobot(ctx.world, Owner.Player, { x: bp.x, y: bp.y }, ChassisType.Wheels, WeaponType.Radar);
    radar.script = makeDefendBase();
    const raider = spawnRobot(ctx.world, Owner.AI, { x: bp.x + 200, y: bp.y }, ChassisType.Tracks, WeaponType.Cannon);

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(radar.targetId).toBeUndefined();
    // Patrolling near the base, not driving at the raider.
    expect(radar.movement!.goal!.x).not.toBeCloseTo(raider.position!.x, 0);
  });
});

describe('taskSystem — GroupAttack gathers before it goes', () => {
  /** `n` robots on GroupAttack, uncommitted, parked on their own base. */
  function seedGroup(ctx: GameContext, n: number) {
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const bp = base.position!;
    const group = [];
    for (let i = 0; i < n; i++) {
      const r = spawnRobot(
        ctx.world,
        Owner.Player,
        { x: bp.x + i * 8, y: bp.y },
        ChassisType.Tracks,
        WeaponType.Cannon,
      );
      r.script = makeGroupAttack();
      group.push(r);
    }
    // Something to march on, far away and already known, so "committed" shows up
    // as movement rather than as a search roam.
    const enemyBase = spawnBase(ctx.world, Owner.AI, 2, 2);
    ctx.intel[Owner.Player].knownBaseIds.add(enemyBase.id);
    return { base, group, enemyBase };
  }

  it('holds the base line while the group is short of strength', () => {
    const ctx = makeCtx(4);
    openGround(ctx);
    const { group, enemyBase } = seedGroup(ctx, gameConfig.behavior.groupAttackSize - 1);

    visionSystem(ctx);
    taskSystem(ctx, DT);

    for (const r of group) {
      expect(r.script!.blackboard.committed).toBe(false);
      // Defending the base, not marching on the enemy one.
      expect(r.movement!.goal?.x).not.toBeCloseTo(enemyBase.position!.x, 0);
    }
  });

  it('commits the whole group in one tick once it is strong enough', () => {
    const ctx = makeCtx(4);
    openGround(ctx);
    const { group, enemyBase } = seedGroup(ctx, gameConfig.behavior.groupAttackSize);

    visionSystem(ctx);
    taskSystem(ctx, DT);

    // Every one of them, not just the first the resolver happened to reach:
    // committing one at a time would shrink the waiting pool below the threshold
    // and strand the tail at base for good.
    for (const r of group) {
      expect(r.script!.blackboard.committed).toBe(true);
      expect(r.movement!.goal!.x).toBeCloseTo(enemyBase.position!.x, 0);
    }
  });

  it('does not turn a committed group around when it takes losses', () => {
    const ctx = makeCtx(4);
    openGround(ctx);
    const { group, enemyBase } = seedGroup(ctx, gameConfig.behavior.groupAttackSize);

    visionSystem(ctx);
    taskSystem(ctx, DT);
    expect(group.every((r) => r.script!.blackboard.committed)).toBe(true);

    // Wipe out all but one — the survivor is now well below the group size.
    for (const r of group.slice(1)) ctx.world.remove(r);

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(group[0].script!.blackboard.committed).toBe(true);
    expect(group[0].movement!.goal!.x).toBeCloseTo(enemyBase.position!.x, 0);
  });

  it('does not count a group that has already left toward the next one', () => {
    const ctx = makeCtx(4);
    openGround(ctx);
    const { base, group } = seedGroup(ctx, gameConfig.behavior.groupAttackSize);

    visionSystem(ctx);
    taskSystem(ctx, DT);
    expect(group.every((r) => r.script!.blackboard.committed)).toBe(true);

    // One fresh unit rolls out while the wave is still on the board. If departed
    // units counted, it would set off alone — the trickle this replaced.
    const rookie = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: base.position!.x, y: base.position!.y },
      ChassisType.Tracks,
      WeaponType.Cannon,
    );
    rookie.script = makeGroupAttack();

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(rookie.script!.blackboard.committed).toBe(false);
  });
});

describe('taskSystem — anti-air is a last resort', () => {
  it('a missile robot with nothing else to shoot engages an enemy drone in range', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const aa = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    aa.script = { programId: TaskType.Idle, blackboard: {} };
    const drone = spawnDrone(ctx.world, Owner.AI, { x: 480, y: 400 });

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(aa.targetId).toBe(drone.id);
  });

  it('never picks the drone over a ground target it can already engage', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const aa = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    aa.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnDrone(ctx.world, Owner.AI, { x: 420, y: 400 }); // closer, but still second in line

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(aa.targetId).toBe(foe.id);
  });

  it('does not chase the drone — it only fires if one strays into range', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const aa = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    aa.script = { programId: TaskType.Idle, blackboard: {} };
    spawnDrone(ctx.world, Owner.AI, { x: 480, y: 400 });

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(aa.movement!.goal).toBeUndefined();
  });

  it('leaves the drone alone when it is out of weapon range', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const aa = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    aa.script = { programId: TaskType.Idle, blackboard: {} };
    // Inside the wheels chassis's 230px sight, well beyond the 170px missile range.
    spawnDrone(ctx.world, Owner.AI, { x: 600, y: 400 });

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(aa.targetId).toBeUndefined();
  });

  it('a cannon robot cannot engage a drone at all', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Cannon);
    gun.script = { programId: TaskType.Idle, blackboard: {} };
    spawnDrone(ctx.world, Owner.AI, { x: 440, y: 400 });

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
  });

  it('ignores a drone that is riding inside a robot', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const aa = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Wheels, WeaponType.Missiles);
    aa.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const carrier = spawnRobot(ctx.world, Owner.AI, { x: 480, y: 400 }, ChassisType.Tracks, WeaponType.None);
    const drone = spawnDrone(ctx.world, Owner.AI, { x: 480, y: 400 });
    drone.drone!.possessedId = carrier.id;

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(aa.targetId).toBe(carrier.id); // the hull, never the passenger
  });
});

describe('taskSystem — the directed-energy knock-out', () => {
  it('does not run the program of a disabled robot', () => {
    const ctx = makeCtx(2);
    const hunter = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hunter.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hunter.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(hunter.targetId).toBeUndefined();
  });

  it('counts the knock-out down and drops it when it runs out', () => {
    const ctx = makeCtx(2);
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    robot.disabled = { left: gameConfig.robots.weapons.dew.freezeDuration };

    // Bounded either side rather than pinned to an exact tick: summing `dt` 240
    // times leaves a sub-picosecond residue, which costs one extra frame. It is
    // the same residue on every peer, so it is harmless — just not exact.
    const ticks = Math.ceil(gameConfig.robots.weapons.dew.freezeDuration / DT);
    for (let i = 0; i < ticks - 1; i++) taskSystem(ctx, DT);
    expect(robot.disabled).toBeDefined();

    taskSystem(ctx, DT);
    taskSystem(ctx, DT);
    expect(robot.disabled).toBeUndefined();
  });

  it('an idle gun finishes off a disabled enemy inside its range', () => {
    // Regression: a directed-energy hit used to *protect* its target from idle
    // guns. Idle only shoots whoever is shooting it, so silencing the enemy also
    // ended the under-fire window that was the sole reason anyone was firing.
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    expect(gun.script!.programId).toBe(TaskType.Idle);
    foe.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBe(foe.id);
  });

  it('but does not chase one that is out of range — idle still holds position', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    // Inside the tracks hull's 190px sight, well outside the cannon's 120px reach.
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 560, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    foe.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
    expect(gun.movement!.goal).toBeUndefined();
  });

  it('a dew gun holds its shot rather than re-freezing an already frozen target', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    foe.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
  });

  it('resumes the order it was given while it was out', () => {
    const ctx = makeCtx(2);
    const hunter = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hunter.disabled = { left: DT }; // one tick left
    // The order lands while it is still out; nothing may overwrite it.
    hunter.script = { programId: TaskType.AttackRobots, blackboard: {} };

    // Vision has to be re-run each step like the real pipeline does: while it is
    // out, the hunter spots nothing, so its side's intel is empty until it wakes.
    visionSystem(ctx);
    taskSystem(ctx, DT); // recovers on this tick
    expect(hunter.targetId).toBeUndefined(); // …but saw nothing while it was out
    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(hunter.targetId).toBe(foe.id);
  });
});
