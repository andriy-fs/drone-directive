import { describe, expect, it } from 'vitest';
import { gameConfig } from '../../config/gameConfig';
import { ChassisType, Owner, RobotState, TaskType, WeaponType } from '../../types/enums';
import { distance } from '../../utils/math';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { makeAttackTarget, makeGuard } from '../tasks/taskDefinitions';
import { makeCtx } from './testkit';
import { taskSystem } from './task';
import { movementSystem } from './movement';
import { visionSystem } from './vision';

const DT = gameConfig.fixedDt;

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
