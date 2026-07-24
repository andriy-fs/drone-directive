import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, TaskType, WeaponType } from '../../types/enums';
import { spawnRobot } from '../ecs/factory';
import { makeGuard } from '../tasks/taskDefinitions';
import { commandsSystem } from './commands';
import { makeCtx } from './testkit';

describe('commandsSystem — AssignTask refuses attack orders for a radar', () => {
  it('ignores "Attack Robots" for a radar, leaving its current directive untouched', () => {
    const ctx = makeCtx();
    const radar = spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Radar);
    radar.script = makeGuard(radar.position!);
    ctx.commands.push({ kind: 'AssignTask', robotId: radar.id, task: TaskType.AttackRobots });
    commandsSystem(ctx);
    expect(radar.script!.programId).toBe(TaskType.Guard);
  });

  it('ignores "Attack Base" for a radar, leaving its current directive untouched', () => {
    const ctx = makeCtx();
    const radar = spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Radar);
    radar.script = makeGuard(radar.position!);
    ctx.commands.push({ kind: 'AssignTask', robotId: radar.id, task: TaskType.AttackBase });
    commandsSystem(ctx);
    expect(radar.script!.programId).toBe(TaskType.Guard);
  });

  it('still lets a radar be assigned Overwatch', () => {
    const ctx = makeCtx();
    const radar = spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Radar);
    ctx.commands.push({ kind: 'AssignTask', robotId: radar.id, task: TaskType.Overwatch });
    commandsSystem(ctx);
    expect(radar.script!.programId).toBe(TaskType.Overwatch);
  });

  it('does not affect a normally armed robot given the same order', () => {
    const ctx = makeCtx();
    const cannon = spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    ctx.commands.push({ kind: 'AssignTask', robotId: cannon.id, task: TaskType.AttackRobots });
    commandsSystem(ctx);
    expect(cannon.script!.programId).toBe(TaskType.AttackRobots);
  });
});
