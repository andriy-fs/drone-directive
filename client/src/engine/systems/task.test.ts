import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, RobotState, TaskType, WeaponType } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import { spawnBase, spawnDrone, spawnRobot } from '../ecs/factory';
import type { GameContext } from '../game/context';
import { makeAttackTarget, makeGuard, makeOverwatch } from '../tasks/taskDefinitions';
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
