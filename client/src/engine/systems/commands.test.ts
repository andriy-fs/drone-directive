import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, TaskType, WeaponType } from '@drone-directive/types/enums';
import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { spawnBase, spawnRobot } from '../ecs/factory';
import { makeGuard } from '../tasks/taskDefinitions';
import { commandsSystem, isCommandFrom } from './commands';
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

describe('commandsSystem — SetRallyPoint', () => {
  it('sets, then clears, a base rally point', () => {
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    ctx.commands.push({ kind: 'SetRallyPoint', baseId: base.id, point: { x: 300, y: 400 } });
    commandsSystem(ctx);
    expect(base.production!.rally).toEqual({ x: 300, y: 400 });

    ctx.commands.push({ kind: 'SetRallyPoint', baseId: base.id, point: null });
    commandsSystem(ctx);
    expect(base.production!.rally).toBeNull();
  });

  it('clamps a point off the map — solo play never meets the wire validator', () => {
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    ctx.commands.push({ kind: 'SetRallyPoint', baseId: base.id, point: { x: -50, y: 1e9 } });
    commandsSystem(ctx);
    expect(base.production!.rally).toEqual({ x: 0, y: worldPixelSize.height });
  });

  it('ignores a rally point aimed at something that is not a base', () => {
    const ctx = makeCtx();
    const robot = spawnRobot(ctx.world, Owner.Player, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);
    ctx.commands.push({ kind: 'SetRallyPoint', baseId: robot.id, point: { x: 300, y: 400 } });
    expect(() => commandsSystem(ctx)).not.toThrow();
  });
});

describe('isCommandFrom — a side may only command what it owns', () => {
  const spawn = (ctx: ReturnType<typeof makeCtx>, owner: Owner) =>
    spawnRobot(ctx.world, owner, { x: 100, y: 100 }, ChassisType.Tracks, WeaponType.Cannon);

  it("accepts AssignTask on an own robot and rejects it on the enemy's", () => {
    const ctx = makeCtx();
    const mine = spawn(ctx, Owner.Player);
    const theirs = spawn(ctx, Owner.AI);
    const task = TaskType.AttackRobots;
    expect(isCommandFrom(ctx, { kind: 'AssignTask', robotId: mine.id, task }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'AssignTask', robotId: theirs.id, task }, Owner.Player)).toBe(false);
  });

  it('rejects a MoveRobots batch that contains any foreign robot', () => {
    const ctx = makeCtx();
    const mine = spawn(ctx, Owner.Player);
    const theirs = spawn(ctx, Owner.AI);
    const point = { x: 200, y: 200 };
    expect(isCommandFrom(ctx, { kind: 'MoveRobots', robotIds: [mine.id], point }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'MoveRobots', robotIds: [mine.id, theirs.id], point }, Owner.Player)).toBe(false);
  });

  it('checks the attackers of AttackTarget, not the target (which is the enemy)', () => {
    const ctx = makeCtx();
    const mine = spawn(ctx, Owner.Player);
    const theirs = spawn(ctx, Owner.AI);
    expect(isCommandFrom(ctx, { kind: 'AttackTarget', robotIds: [mine.id], targetId: theirs.id }, Owner.Player)).toBe(
      true,
    );
    expect(isCommandFrom(ctx, { kind: 'AttackTarget', robotIds: [theirs.id], targetId: mine.id }, Owner.Player)).toBe(
      false,
    );
  });

  it('rejects build orders aimed at the enemy base', () => {
    const ctx = makeCtx();
    const mine = spawnBase(ctx.world, Owner.Player, 2, 2);
    const theirs = spawnBase(ctx.world, Owner.AI, 20, 20);
    const order = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    expect(isCommandFrom(ctx, { kind: 'BuildRobot', baseId: mine.id, order }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'BuildRobot', baseId: theirs.id, order }, Owner.Player)).toBe(false);
    expect(isCommandFrom(ctx, { kind: 'SetAutoBuild', baseId: theirs.id, order: null }, Owner.Player)).toBe(false);
    const task = TaskType.Guard;
    expect(isCommandFrom(ctx, { kind: 'SetDefaultTask', baseId: mine.id, task }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'SetDefaultTask', baseId: theirs.id, task }, Owner.Player)).toBe(false);
    const point = { x: 100, y: 100 };
    expect(isCommandFrom(ctx, { kind: 'SetRallyPoint', baseId: mine.id, point }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'SetRallyPoint', baseId: theirs.id, point }, Owner.Player)).toBe(false);
  });

  it('mirrors for the online guest, who plays Owner.AI', () => {
    const ctx = makeCtx();
    const hostRobot = spawn(ctx, Owner.Player);
    const guestRobot = spawn(ctx, Owner.AI);
    const task = TaskType.Guard;
    expect(isCommandFrom(ctx, { kind: 'AssignTask', robotId: guestRobot.id, task }, Owner.AI)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'AssignTask', robotId: hostRobot.id, task }, Owner.AI)).toBe(false);
  });

  it('rejects a command naming an entity that no longer exists', () => {
    const ctx = makeCtx();
    expect(isCommandFrom(ctx, { kind: 'AssignTask', robotId: 'robot:gone', task: TaskType.Guard }, Owner.Player)).toBe(
      false,
    );
  });
});

describe('commandsSystem — ActivateShield', () => {
  it('raises the dome on an owned base and burns the charge', () => {
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    ctx.commands.push({ kind: 'ActivateShield', baseId: base.id });
    commandsSystem(ctx);
    expect(base.shield).toEqual({ hp: gameConfig.bases.shield.hp, left: gameConfig.bases.shield.duration });
    expect(base.shieldSpent).toBe(true);
  });

  it('raises it with no enemy in sight at all — the engine does not re-check the HUD gate', () => {
    // Deliberate, and pinned here so nobody "fixes" it: pre-casting only wastes
    // the player's own single charge, whereas dropping a panic-button press
    // would be indistinguishable from the game freezing.
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    expect(ctx.intel[Owner.Player].visibleRobotIds.size).toBe(0);
    ctx.commands.push({ kind: 'ActivateShield', baseId: base.id });
    commandsSystem(ctx);
    expect(base.shield).toBeDefined();
  });

  it('is a silent no-op the second time, and for a dead or unknown base', () => {
    const ctx = makeCtx();
    const base = spawnBase(ctx.world, Owner.Player, 2, 2);
    ctx.commands.push({ kind: 'ActivateShield', baseId: base.id });
    commandsSystem(ctx);
    base.shield!.hp = 10;

    ctx.commands.push({ kind: 'ActivateShield', baseId: base.id });
    ctx.commands.push({ kind: 'ActivateShield', baseId: 'base:gone' });
    commandsSystem(ctx);
    expect(base.shield!.hp).toBe(10);

    const dead = spawnBase(ctx.world, Owner.Player, 10, 10);
    dead.hp = 0;
    ctx.commands.push({ kind: 'ActivateShield', baseId: dead.id });
    commandsSystem(ctx);
    expect(dead.shield).toBeUndefined();
  });

  it('belongs to the side that owns the base, like every other base command', () => {
    const ctx = makeCtx();
    const mine = spawnBase(ctx.world, Owner.Player, 2, 2);
    const theirs = spawnBase(ctx.world, Owner.AI, 20, 20);
    expect(isCommandFrom(ctx, { kind: 'ActivateShield', baseId: mine.id }, Owner.Player)).toBe(true);
    expect(isCommandFrom(ctx, { kind: 'ActivateShield', baseId: theirs.id }, Owner.Player)).toBe(false);
  });
});
