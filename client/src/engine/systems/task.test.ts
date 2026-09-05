import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, RobotState, TaskType, WeaponType } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import { spawnBase, spawnDrone, spawnMunition, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import {
  makeAttackRobots,
  makeAttackTarget,
  makeDefendBase,
  makeGroupAttack,
  makeGuard,
  makeOverwatch,
} from '../tasks/taskDefinitions';
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

  it('trails a jammer close enough that its bubble actually covers the group', () => {
    const ctx = makeCtx(2);
    spawnBase(ctx.world, Owner.Player, 4, 33);
    const jammer = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 900 }, ChassisType.Tracks, WeaponType.Ew);
    jammer.script = makeOverwatch();
    const vanguard = spawnRobot(ctx.world, Owner.Player, { x: 900, y: 900 }, ChassisType.Tracks, WeaponType.Cannon);
    vanguard.script = { programId: TaskType.AttackBase, blackboard: {} };

    taskSystem(ctx, DT);

    const goal = jammer.movement!.goal!;
    const gap = distance(goal.x, goal.y, vanguard.position!.x, vanguard.position!.y);
    expect(gap).toBeCloseTo(gameConfig.behavior.jammerTrailDistance, 5);
    // The point of the whole exception: a spotter's distance would leave the
    // group it is escorting outside the one thing this hull contributes.
    expect(gap).toBeLessThan(gameConfig.robots.weapons.ew.jamRadius);
    expect(gameConfig.behavior.overwatchTrailDistance).toBeGreaterThan(gameConfig.robots.weapons.ew.jamRadius);
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
    // Beyond the 255 px missile range — and lit for the side by a radar hull, since
    // the missile now reaches further than any chassis can see on its own.
    spawnRobot(ctx.world, Owner.Player, { x: 660, y: 400 }, ChassisType.Wheels, WeaponType.Radar);
    spawnDrone(ctx.world, Owner.AI, { x: 700, y: 400 });

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

describe('taskSystem — a kamikaze on its lit fuse', () => {
  it('is left out of the resolver: nothing re-aims a bomb that has committed', () => {
    // It cannot be walked away, re-targeted or pulled into a formation any more —
    // `combatSystem` owns both the countdown and its end. Resolving it would write a
    // goal it is never going to drive to.
    const ctx = makeCtx(2);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Wheels, WeaponType.Bomb);
    bomb.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    bomb.arming = { left: gameConfig.robots.weapons.bomb.armingTime };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(bomb.targetId).toBeUndefined();
    expect(bomb.movement!.goal).toBeUndefined();
  });

  it('does not burn the fuse: only combat may spend it', () => {
    // Two systems decaying one timer is two different countdowns, and the one that
    // matters is the one that can detonate.
    const ctx = makeCtx(2);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Wheels, WeaponType.Bomb);
    const left = gameConfig.robots.weapons.bomb.armingTime;
    bomb.arming = { left };

    for (let i = 0; i < 10; i++) taskSystem(ctx, DT);

    expect(bomb.arming!.left).toBe(left);
  });
});

describe('taskSystem — a hull under a pilot', () => {
  it('stands the program down: nobody drives a machine two ways at once', () => {
    // This is what lets the drone board a hull that is already marching. Left
    // running, the program would re-issue a goal every tick and hand the machine
    // back walking somewhere the pilot never chose.
    const ctx = makeCtx(2);
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hull.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 50, y: 50 });
    drone.drone.possessedId = hull.id;

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(hull.targetId).toBeUndefined();
    expect(hull.movement.goal).toBeUndefined();
  });

  it('does not light a kamikaze fuse under the pilot', () => {
    // The one outcome that would be irreversible: `beginArming` is committed, and
    // `movementSystem` parks the hull on `isArming` — the pilot would lose the
    // wheel and the choice of when to go up in the same tick.
    const ctx = makeCtx(2);
    const bomb = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Wheels, WeaponType.Bomb);
    bomb.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 80, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 50, y: 50 });
    drone.drone.possessedId = bomb.id;

    visionSystem(ctx);
    for (let i = 0; i < 10; i++) taskSystem(ctx, DT);

    expect(bomb.arming).toBeUndefined();
  });

  it('picks the program back up the moment the pilot steps off', () => {
    // Same deal a knocked-out robot gets: nothing here overwrites the script, so
    // the order it was given is still there to resume.
    const ctx = makeCtx(2);
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hull.script = { programId: TaskType.AttackRobots, blackboard: {} };
    spawnRobot(ctx.world, Owner.AI, { x: 110, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 50, y: 50 });
    drone.drone.possessedId = hull.id;

    visionSystem(ctx);
    taskSystem(ctx, DT);
    expect(hull.targetId).toBeUndefined();

    drone.drone.possessedId = undefined;
    taskSystem(ctx, DT);

    expect(hull.targetId).toBeDefined();
  });

  it('keeps the under-fire window ticking down while the hull is ridden', () => {
    // The machine is still being shot at. Freezing the window would hand back a
    // hull that thinks the fight is still on.
    const ctx = makeCtx(2);
    const hull = spawnRobot(ctx.world, Owner.Player, { x: 50, y: 50 }, ChassisType.Tracks, WeaponType.Cannon);
    hull.threat = { underFireLeft: 1 };
    const drone = spawnDrone(ctx.world, Owner.Player, { x: 50, y: 50 });
    drone.drone.possessedId = hull.id;

    taskSystem(ctx, DT);

    expect(hull.threat.underFireLeft).toBeCloseTo(1 - DT, 6);
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
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Legs, WeaponType.Cannon);
    // Halfway between the cannon's reach and the legs hull's sight: seen, but not
    // shootable. Read off the config rather than written out, because that gap is
    // exactly what a balance pass moves — pinning it to a literal made this test fail
    // the day the cannon's range went up.
    const seenNotShot = (gameConfig.robots.weapons.cannon.range + gameConfig.robots.chassis.legs.sight) / 2;
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 400 + seenNotShot, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
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

describe('taskSystem — a dew gun does not spend its shot on an already-frozen target', () => {
  it('skips a closer frozen enemy for a live one further away', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    gun.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const frozen = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    frozen.disabled = { left: 8 };
    const alive = spawnRobot(ctx.world, Owner.AI, { x: 580, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBe(alive.id);
  });

  it('holds its shot rather than firing at all when every known enemy is frozen', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    gun.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const frozen = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    frozen.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
  });

  it('leaves an ordinary cannon unaffected — it still finishes off the frozen target', () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    gun.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const frozen = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    frozen.disabled = { left: 8 };

    visionSystem(ctx);
    taskSystem(ctx, DT);

    expect(gun.targetId).toBe(frozen.id);
  });

  it('never picks an enemy base as a target — there is no crew to knock out', () => {
    const ctx = makeCtx(2);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    gun.script = { programId: TaskType.AttackRobots, blackboard: {} };
    const base = spawnBase(ctx.world, Owner.AI, 2, 2);
    ctx.intel[Owner.Player].knownBaseIds.add(base.id);

    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
  });

  it('does not return fire at an attacker that is already frozen', () => {
    const ctx = makeCtx(2);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Dew);
    gun.script = { programId: TaskType.Idle, blackboard: {} };
    const attacker = spawnRobot(ctx.world, Owner.AI, { x: 260, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    attacker.disabled = { left: 8 };
    gun.threat = { attackerId: attacker.id, underFireLeft: gameConfig.behavior.underFireDuration };

    taskSystem(ctx, DT);

    expect(gun.targetId).toBeUndefined();
  });

  it('a cannon still returns fire at an attacker even once it is frozen', () => {
    const ctx = makeCtx(2);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    gun.script = { programId: TaskType.Idle, blackboard: {} };
    const attacker = spawnRobot(ctx.world, Owner.AI, { x: 260, y: 200 }, ChassisType.Tracks, WeaponType.Cannon);
    attacker.disabled = { left: 8 };
    gun.threat = { attackerId: attacker.id, underFireLeft: gameConfig.behavior.underFireDuration };

    taskSystem(ctx, DT);

    expect(gun.targetId).toBe(attacker.id);
  });

  it("obeys a player's explicit order (AttackTarget) even once the target freezes", () => {
    const ctx = makeCtx(2);
    openGround(ctx);
    const gun = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Dew);
    const target = spawnRobot(ctx.world, Owner.AI, { x: 460, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    target.disabled = { left: 8 };
    gun.script = makeAttackTarget(target.id);

    taskSystem(ctx, DT);

    expect(gun.targetId).toBe(target.id);
  });
});

describe('taskSystem — the base battery picks its own target', () => {
  const RANGE = gameConfig.robots.weapons[gameConfig.bases.weapon].range;

  /** A base with clear ground around it, plus a helper for "N px along +x". */
  function stage(ctx: GameContext) {
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 4, 33);
    return { base, at: (dist: number) => ({ x: base.position!.x + dist, y: base.position!.y }) };
  }

  function resolve(ctx: GameContext): void {
    visionSystem(ctx);
    taskSystem(ctx, DT);
  }

  it('takes a spotted enemy robot inside its range', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);

    resolve(ctx);

    expect(base.targetId).toBe(foe.id);
  });

  it('prefers an enemy drone over a ground robot both in range', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    // The robot is the *closer* of the two: only the air-first rule can explain
    // the drone winning, so this cannot pass by accident on distance.
    spawnRobot(ctx.world, Owner.AI, at(60), ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.AI, at(140));

    resolve(ctx);

    expect(base.targetId).toBe(drone.id);
  });

  it('ignores a drone riding a robot — it is inside that hull, not in the air', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    const carrier = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    const drone = spawnDrone(ctx.world, Owner.AI, at(120));
    drone.drone!.possessedId = carrier.id;

    resolve(ctx);

    expect(base.targetId).toBe(carrier.id);
  });

  it('leaves an enemy outside its range alone even though it can see it', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    // Beyond the battery's reach. The battery now outranges the base's own 260 px
    // sight, so the sighting has to come from somewhere — a picket parked next to
    // the foe, which is exactly how the range surplus is meant to be used.
    const foe = spawnRobot(ctx.world, Owner.AI, at(RANGE + 40), ChassisType.Tracks, WeaponType.Cannon);
    spawnRobot(ctx.world, Owner.Player, at(RANGE + 20), ChassisType.Wheels, WeaponType.Radar);

    resolve(ctx);

    expect(ctx.intel[Owner.Player].visibleRobotIds.has(foe.id)).toBe(true); // the premise of the test
    expect(base.targetId).toBeUndefined();
  });

  it('will not fire on an enemy nobody has spotted', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    // Skip visionSystem: intel stays empty, as if the base were blinded.
    ctx.intel[Owner.Player].visibleRobotIds = new Set();
    taskSystem(ctx, DT);

    expect(base.targetId).toBeUndefined();
    expect(foe.hp).toBe(foe.maxHp);
  });

  it('never picks a friendly', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    spawnRobot(ctx.world, Owner.Player, at(120), ChassisType.Tracks, WeaponType.Cannon);

    resolve(ctx);

    expect(base.targetId).toBeUndefined();
  });

  it('turns the launcher toward whatever it picked', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);

    resolve(ctx);

    expect(base.heading).toBeCloseTo(0, 5); // due east, where the target stands
  });

  it('a fallen base holds no target', () => {
    const ctx = makeCtx(3);
    const { base, at } = stage(ctx);
    const foe = spawnRobot(ctx.world, Owner.AI, at(120), ChassisType.Tracks, WeaponType.Cannon);
    base.targetId = foe.id;
    base.hp = 0;

    resolve(ctx);

    expect(base.targetId).toBeUndefined();
  });
});

describe('taskSystem — air defence sees strike drones, not just observers', () => {
  it('a base battery intercepts an incoming strike drone', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.Player, 20, 20);
    const m = spawnMunition(
      ctx.world,
      Owner.AI,
      { x: base.position!.x + 100, y: base.position!.y },
      0,
      base.id,
      gameConfig.robots.weapons.fpv.damage,
      'carrier',
      WeaponType.Fpv,
    );
    visionSystem(ctx);

    taskSystem(ctx, DT);

    expect(base.targetId).toBe(m.id);
  });

  it('a missile robot with nothing else to do takes a shot at one', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const guard = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Missiles);
    const m = spawnMunition(
      ctx.world,
      Owner.AI,
      { x: 480, y: 400 },
      0,
      guard.id,
      gameConfig.robots.weapons.fpv.damage,
      'carrier',
      WeaponType.Fpv,
    );
    visionSystem(ctx);

    taskSystem(ctx, DT);

    expect(guard.targetId).toBe(m.id);
  });

  it('a cannon robot cannot — anti-air is still a `canHitAir` privilege', () => {
    const ctx = makeCtx(1);
    openGround(ctx);
    const guard = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Cannon);
    spawnMunition(
      ctx.world,
      Owner.AI,
      { x: 440, y: 400 },
      0,
      guard.id,
      gameConfig.robots.weapons.fpv.damage,
      'carrier',
      WeaponType.Fpv,
    );
    visionSystem(ctx);

    taskSystem(ctx, DT);

    expect(guard.targetId).toBeUndefined();
  });
});

describe('taskSystem — an FPV carrier stands still and shells what its side can see', () => {
  it('holds its ground with a mountain in the way, and still takes the shot', () => {
    const ctx = makeCtx(1);
    const { width, height } = gameConfig.grid;
    ctx.sightBlockers = Array.from({ length: height }, () => new Array<boolean>(width).fill(true));
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 200, y: 200 }, ChassisType.Tracks, WeaponType.Fpv);
    carrier.script = makeAttackRobots();
    const foe = spawnRobot(ctx.world, Owner.AI, { x: 1200, y: 200 }, ChassisType.Wheels, WeaponType.Cannon);
    ctx.intel.player.visibleRobotIds = new Set([foe.id]);

    taskSystem(ctx, DT);

    expect(carrier.targetId).toBe(foe.id);
    expect(carrier.movement!.goal).toBeUndefined(); // never advances: everything is already "in range"
  });
});

describe('taskSystem — a carrier does not queue up on a target already killed', () => {
  const FPV = gameConfig.robots.weapons.fpv;

  /** A carrier watching two enemies: `doomed` already has a salvo in the air. */
  function stagePair(ctx: GameContext) {
    openGround(ctx);
    const carrier = spawnRobot(ctx.world, Owner.Player, { x: 400, y: 400 }, ChassisType.Tracks, WeaponType.Fpv);
    carrier.script = makeAttackRobots();
    // The doomed one is the *closer* of the two, so nothing but the ledger can
    // explain the other winning the pick.
    const doomed = spawnRobot(ctx.world, Owner.AI, { x: 500, y: 400 }, ChassisType.Wheels, WeaponType.Cannon);
    const healthy = spawnRobot(ctx.world, Owner.AI, { x: 560, y: 400 }, ChassisType.Wheels, WeaponType.Cannon);
    ctx.intel.player.visibleRobotIds = new Set([doomed.id, healthy.id]);
    return { carrier, doomed, healthy };
  }

  /** Puts a whole salvo's worth of damage in the air, locked on `targetId`. */
  function salvoInFlight(ctx: GameContext, targetId: string, from: { x: number; y: number }): void {
    for (let i = 0; i < FPV.salvo; i++) {
      spawnMunition(ctx.world, Owner.Player, from, 0, targetId, FPV.damage, 'carrier', WeaponType.Fpv);
    }
  }

  it('moves on to the next enemy instead of standing over a corpse', () => {
    const ctx = makeCtx(1);
    const { carrier, doomed, healthy } = stagePair(ctx);
    doomed.hp = FPV.damage * FPV.salvo - 10;
    salvoInFlight(ctx, doomed.id, { x: 450, y: 400 });

    taskSystem(ctx, DT);

    expect(carrier.targetId).toBe(healthy.id);
  });

  it('still takes the closer one while the salvo in the air falls short of killing it', () => {
    const ctx = makeCtx(1);
    const { carrier, doomed } = stagePair(ctx);
    doomed.hp = FPV.damage * FPV.salvo + 10;
    salvoInFlight(ctx, doomed.id, { x: 450, y: 400 });

    taskSystem(ctx, DT);

    expect(carrier.targetId).toBe(doomed.id);
  });
});

describe('taskSystem — closing on a base the side has found but cannot see', () => {
  /** A missile hull ordered onto a base it discovered earlier and no longer watches. */
  function stage(ctx: GameContext, gap: number) {
    openGround(ctx);
    const base = spawnBase(ctx.world, Owner.AI, 20, 20);
    const robot = spawnRobot(
      ctx.world,
      Owner.Player,
      { x: base.position!.x - gap, y: base.position!.y },
      ChassisType.Wheels,
      WeaponType.Missiles,
    );
    robot.script = { programId: TaskType.AttackBase, blackboard: {} };
    ctx.intel.player.knownBaseIds = new Set([base.id]);
    ctx.intel.player.visibleBaseIds = new Set();
    return { robot, base };
  }

  it('keeps advancing while the base is in reach but out of sight', () => {
    // The regression this guards: the missile outreaches the hull's own sight, so
    // "in range" arrived before "can see it". The robot held — in range, so no
    // reason to move — and never fired, because nothing was watching the target.
    const ctx = makeCtx(1);
    const { robot } = stage(ctx, gameConfig.robots.weapons.missiles.range - 10);

    taskSystem(ctx, DT);

    expect(robot.movement!.goal).toBeDefined();
  });

  it('stops and fires as soon as it can see it', () => {
    const ctx = makeCtx(1);
    const { robot, base } = stage(ctx, gameConfig.robots.weapons.missiles.range - 10);
    ctx.intel.player.visibleBaseIds = new Set([base.id]);

    taskSystem(ctx, DT);

    expect(robot.movement!.goal).toBeUndefined();
    expect(robot.targetId).toBe(base.id);
  });
});
