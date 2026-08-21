import type { Command } from '@drone-directive/types/commands';
import { ChassisType, FormationType, TaskType, WeaponType } from '@drone-directive/types/enums';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setNetDebug } from '../debug';
import { parseCommands, parseDroneControl, type CommandLimits } from './validation';

/**
 * The peer's input is the one thing in a lockstep match a client doesn't control,
 * and before this layer existed it went straight into the engine. These check both
 * halves of the contract: everything a correct client sends survives untouched,
 * and everything a broken or hostile one might send is dropped without taking the
 * match down.
 *
 * Note there is no game config anywhere here — the limits are just numbers, which
 * is exactly what splitting this package out bought.
 */

/** Stand-in for a small map with the default per-side robot cap. */
const limits: CommandLimits = { worldWidth: 1280, worldHeight: 1280, maxRobots: 12 };

const inBounds = { x: 100, y: 200 };

/** One valid sample per `Command['kind']` — the exhaustive record is the point. */
const valid: Record<Command['kind'], Command> = {
  AssignTask: { kind: 'AssignTask', robotId: 'robot_1', task: TaskType.Guard },
  BuildRobot: {
    kind: 'BuildRobot',
    baseId: 'base_1',
    order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon, task: TaskType.Scout },
  },
  SetAutoBuild: { kind: 'SetAutoBuild', baseId: 'base_1', order: null },
  SetDefaultTask: { kind: 'SetDefaultTask', baseId: 'base_1', task: TaskType.Guard },
  MoveRobots: { kind: 'MoveRobots', robotIds: ['robot_1', 'robot_2'], point: inBounds },
  AttackTarget: { kind: 'AttackTarget', robotIds: ['robot_1'], targetId: 'base_2' },
  SetRallyPoint: { kind: 'SetRallyPoint', baseId: 'base_1', point: inBounds },
  ActivateShield: { kind: 'ActivateShield', baseId: 'base_1' },
  SetFormation: { kind: 'SetFormation', robotIds: ['robot_1', 'robot_2'], formation: FormationType.Box },
};

const parse = (raw: unknown, over: Partial<CommandLimits> = {}) => parseCommands(raw, 'peer', { ...limits, ...over });

describe('parseCommands', () => {
  it('passes every command kind through unchanged', () => {
    const batch = Object.values(valid);
    expect(parse(batch)).toEqual(batch);
  });

  it('keeps all three states of a build order task', () => {
    const base = { chassis: ChassisType.Legs, weapon: WeaponType.Missiles };
    const batch: Command[] = [
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base } }, // unspecified
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base, task: null } }, // explicitly none
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base, task: TaskType.Overwatch } },
    ];
    const parsed = parse(batch);
    expect(parsed).toEqual(batch);
    // `undefined` and `null` are different orders — the absent key must not become null.
    expect('task' in (parsed[0] as { order: object }).order).toBe(false);
  });

  it('drops a bad command without costing its valid neighbours', () => {
    const batch = [valid.AssignTask, { kind: 'AssignTask', robotId: 'robot_2', task: 'noSuchTask' }, valid.MoveRobots];
    expect(parse(batch)).toEqual([valid.AssignTask, valid.MoveRobots]);
  });

  it('rejects unknown and malformed entries', () => {
    const junk = [
      { kind: 'SelfDestruct', robotId: 'robot_1' },
      { robotId: 'robot_1', task: TaskType.Guard }, // no discriminant at all
      'AssignTask',
      null,
      42,
      [],
    ];
    expect(parse(junk)).toEqual([]);
  });

  it('rejects values outside the game unions', () => {
    const order = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    const junk = [
      { kind: 'AssignTask', robotId: 'robot_1', task: 'guard ' },
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...order, chassis: 'hovercraft' } },
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...order, weapon: 'railgun' } },
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...order, task: 'conquer' } },
    ];
    expect(parse(junk)).toEqual([]);
  });

  it('rejects empty, oversized and malformed robot id lists', () => {
    const tooMany = Array.from({ length: limits.maxRobots + 1 }, (_, i) => `robot_${i}`);
    const junk = [
      { kind: 'MoveRobots', robotIds: [], point: inBounds },
      { kind: 'MoveRobots', robotIds: tooMany, point: inBounds },
      { kind: 'MoveRobots', robotIds: ['robot_1', ''], point: inBounds },
      { kind: 'MoveRobots', robotIds: ['robot_1', 7], point: inBounds },
      { kind: 'AttackTarget', robotIds: [], targetId: 'base_2' },
      { kind: 'AttackTarget', robotIds: ['robot_1'], targetId: '' },
      { kind: 'SetFormation', robotIds: [], formation: FormationType.Line },
      { kind: 'SetFormation', robotIds: tooMany, formation: FormationType.Line },
    ];
    expect(parse(junk)).toEqual([]);
    // Exactly at the cap is still a legal order.
    const atCap = { kind: 'MoveRobots', robotIds: tooMany.slice(0, limits.maxRobots), point: inBounds };
    expect(parse([atCap])).toHaveLength(1);
  });

  it('rejects a formation that is not one of the shapes, and lets null through as "fall out"', () => {
    const clear = { kind: 'SetFormation', robotIds: ['robot_1'], formation: null };
    expect(parse([clear])).toEqual([clear]);

    const junk = [
      { kind: 'SetFormation', robotIds: ['robot_1'], formation: 'phalanx' },
      { kind: 'SetFormation', robotIds: ['robot_1'], formation: 3 },
      { kind: 'SetFormation', robotIds: ['robot_1'] }, // absent is not the same as null
    ];
    expect(parse(junk)).toEqual([]);
  });

  it('rejects a shield activation whose base id is empty or oversized', () => {
    const junk = [
      { kind: 'ActivateShield', baseId: '' },
      { kind: 'ActivateShield', baseId: 'b'.repeat(65) },
      { kind: 'ActivateShield', baseId: 7 },
      { kind: 'ActivateShield' },
    ];
    expect(parse(junk)).toEqual([]);
    expect(parse([{ kind: 'ActivateShield', baseId: 'b'.repeat(64) }])).toHaveLength(1);
  });

  it('rejects move destinations that are not real points on the map', () => {
    const junk = [
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: NaN, y: 0 } },
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: Infinity, y: 0 } },
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: -1, y: 0 } },
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: limits.worldWidth + 1, y: 0 } },
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: 0, y: limits.worldHeight + 1 } },
      { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: 0 } },
    ];
    expect(parse(junk)).toEqual([]);
    // The far corner is still a legal destination.
    const corner = {
      kind: 'MoveRobots',
      robotIds: ['robot_1'],
      point: { x: limits.worldWidth, y: limits.worldHeight },
    };
    expect(parse([corner])).toHaveLength(1);
  });

  it('holds a rally point to the same map bounds, and lets null through as "clear"', () => {
    const clear = { kind: 'SetRallyPoint', baseId: 'base_1', point: null };
    expect(parse([clear])).toEqual([clear]);

    const offMap = [
      { kind: 'SetRallyPoint', baseId: 'base_1', point: { x: limits.worldWidth + 1, y: 0 } },
      { kind: 'SetRallyPoint', baseId: 'base_1', point: { x: 0, y: -1 } },
      { kind: 'SetRallyPoint', baseId: 'base_1', point: { x: NaN, y: 0 } },
      { kind: 'SetRallyPoint', baseId: '', point: inBounds },
    ];
    expect(parse(offMap)).toEqual([]);
  });

  it('lets a base default task through, null included, and refuses anything else', () => {
    // Null is a setting, not an absence: "the robots I build carry no program".
    const clear = { kind: 'SetDefaultTask', baseId: 'base_1', task: null };
    expect(parse([clear])).toEqual([clear]);

    const junk = [
      { kind: 'SetDefaultTask', baseId: 'base_1', task: 'noSuchTask' },
      { kind: 'SetDefaultTask', baseId: 'base_1' }, // absent is not a state here
      { kind: 'SetDefaultTask', baseId: '', task: TaskType.Guard },
    ];
    expect(parse(junk)).toEqual([]);
  });

  it('validates against the limits it is handed, not a captured copy', () => {
    // The host resizes the map between matches, so the same order has to be
    // refused on a small map and accepted on a large one.
    const farOut = { kind: 'MoveRobots', robotIds: ['robot_1'], point: { x: 2000, y: 2000 } };
    expect(parse([farOut])).toEqual([]);
    expect(parse([farOut], { worldWidth: 2560, worldHeight: 2560 })).toHaveLength(1);
  });

  it('discards an oversized batch whole rather than truncating it', () => {
    const flood = Array.from({ length: 1000 }, () => valid.AssignTask);
    expect(parse(flood)).toEqual([]);
  });

  it('rejects a payload that is not an array', () => {
    expect(parse({ kind: 'AssignTask' })).toEqual([]);
    expect(parse(undefined)).toEqual([]);
  });
});

describe('parseDroneControl', () => {
  const input = { dir: { x: 0.6, y: -0.8 }, possessPulse: true, firePulse: false };

  it('passes a well-formed input through', () => {
    expect(parseDroneControl(input, 'peer')).toEqual(input);
  });

  it('refuses input that would poison the simulation', () => {
    // A NaN here walks the drone off the map and takes the world hash with it.
    expect(parseDroneControl({ ...input, dir: { x: NaN, y: 0 } }, 'peer')).toBeNull();
    expect(parseDroneControl({ ...input, dir: { x: Infinity, y: 0 } }, 'peer')).toBeNull();
    // `dir` is a unit vector or zero — nothing a correct client sends exceeds 1.
    expect(parseDroneControl({ ...input, dir: { x: 40, y: 0 } }, 'peer')).toBeNull();
    expect(parseDroneControl({ ...input, possessPulse: 'yes' }, 'peer')).toBeNull();
    expect(parseDroneControl(null, 'peer')).toBeNull();
  });
});

describe('setNetDebug', () => {
  afterEach(() => {
    setNetDebug(false);
    vi.restoreAllMocks();
  });

  it('stays quiet by default, and names the origin when switched on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseCommands(['nonsense'], 'peer', limits);
    expect(warn).not.toHaveBeenCalled();

    setNetDebug(true);
    parseCommands(['nonsense'], 'local', limits);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('local'));
  });
});
