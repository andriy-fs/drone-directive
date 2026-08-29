import { frame, MessageTag, tagOf } from '@drone-directive/protocol';
import {
  encodeCreatedMessage,
  encodeErrorMessage,
  encodeStartMessage,
  MapSize as WireMapSize,
} from '@drone-directive/protocol/codec';
import { describe, expect, it } from 'vitest';
import type { DroneControl } from '@drone-directive/types/entities';
import type { Command } from '@drone-directive/types/commands';
import { ChassisType, FormationType, MapSize, TaskType, WeaponType } from '@drone-directive/types/enums';
import { decodeServerMessage, encodeTick, ErrorCode, mapSizeToQueryParam } from './codec';

/**
 * A binary protocol fails silently when it fails at all: a field written in the
 * wrong order still decodes, just into different values, and under lockstep that
 * surfaces ten seconds later as an unexplained desync. So every message goes out
 * and comes back here, and the assertion is on the *domain* object — the mapping
 * layer is as much under test as the encoding.
 */

const IDLE_DRONE: DroneControl = { dir: { x: 0, y: 0 }, possessPulse: false, firePulse: false };

/** Round-trips one tick's worth of input the way the two peers actually do. */
function roundTrip(commands: Command[], drone: DroneControl = IDLE_DRONE, tick = 7, pauseToggle = false) {
  const bytes = encodeTick(tick, { commands, drone, pauseToggle }, null);
  const decoded = decodeServerMessage(toArrayBuffer(bytes));
  if (decoded?.type !== 'tick') throw new Error(`expected a tick frame, got ${decoded?.type ?? 'null'}`);
  return decoded;
}

/** The socket hands back an `ArrayBuffer`; encoders produce a view into a larger one. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('command round-trip', () => {
  it('carries every command kind there and back unchanged', () => {
    const commands: Command[] = [
      { kind: 'AssignTask', robotId: 'robot_1', task: TaskType.AttackRobots },
      {
        kind: 'BuildRobot',
        baseId: 'base_1',
        order: { chassis: ChassisType.Wheels, weapon: WeaponType.Missiles, task: TaskType.Guard },
        front: true,
      },
      {
        kind: 'SetAutoBuild',
        baseId: 'base_2',
        order: { chassis: ChassisType.Legs, weapon: WeaponType.Ew, task: null },
      },
      { kind: 'SetAutoBuild', baseId: 'base_2', order: null },
      { kind: 'MoveRobots', robotIds: ['robot_1', 'robot_2', 'robot_3'], point: { x: 512.25, y: 96.5 } },
      { kind: 'AttackTarget', robotIds: ['robot_4'], targetId: 'base_1' },
      { kind: 'SetRallyPoint', baseId: 'base_1', point: { x: 640.75, y: 320.5 } },
      { kind: 'SetRallyPoint', baseId: 'base_1', point: null },
      { kind: 'ActivateShield', baseId: 'base_1' },
      { kind: 'SetDefaultTask', baseId: 'base_1', task: TaskType.DefendBase },
      { kind: 'SetDefaultTask', baseId: 'base_1', task: null },
      { kind: 'SetFormation', robotIds: ['robot_1', 'robot_2'], formation: FormationType.Box },
      { kind: 'SetFormation', robotIds: ['robot_3'], formation: null },
    ];
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it('carries every formation shape distinctly', () => {
    const commands: Command[] = Object.values(FormationType).map((formation) => ({
      kind: 'SetFormation',
      robotIds: ['robot_1'],
      formation,
    }));
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it('carries a cancellation with the slot and the order it names', () => {
    const commands: Command[] = [
      { kind: 'CancelQueued', baseId: 'base_1', index: 0, order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon } },
      {
        kind: 'CancelQueued',
        baseId: 'base_2',
        index: 7,
        order: { chassis: ChassisType.Legs, weapon: WeaponType.Fpv, task: TaskType.Scout },
      },
    ];
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it('keeps a queue jump distinct from an ordinary order', () => {
    // One bool, and the only thing that separates the two buttons in the build
    // dialog — a codec that dropped it would silently turn every rush order into
    // a normal one, online only.
    const order = { chassis: ChassisType.Legs, weapon: WeaponType.Dew };
    const commands: Command[] = [
      { kind: 'BuildRobot', baseId: 'base_1', order, front: true },
      { kind: 'BuildRobot', baseId: 'base_1', order, front: false },
    ];
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it('keeps the three states of a build order task distinct', () => {
    const base = { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon };
    const commands: Command[] = [
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base }, front: false }, // unspecified
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base, task: null }, front: false }, // explicitly none
      { kind: 'BuildRobot', baseId: 'base_1', order: { ...base, task: TaskType.Overwatch }, front: true },
    ];
    const decoded = roundTrip(commands).commands;
    expect(decoded).toEqual(commands);
    // The distinction that matters to `production`: an absent key is not a null one.
    expect('task' in (decoded[0] as { order: object }).order).toBe(false);
    expect((decoded[1] as { order: { task: unknown } }).order.task).toBeNull();
  });

  it('covers every member of every game enum it maps', () => {
    const commands: Command[] = Object.values(TaskType).map((task) => ({
      kind: 'AssignTask',
      robotId: 'robot_1',
      task,
    }));
    // `BuildTask` is its own enum (it flattens the tri-state), so every task has
    // to make the trip through a build order as well, not just through AssignTask.
    for (const task of Object.values(TaskType)) {
      commands.push({
        kind: 'BuildRobot',
        baseId: 'base_1',
        order: { chassis: ChassisType.Tracks, weapon: WeaponType.Cannon, task },
        front: false,
      });
    }
    for (const chassis of Object.values(ChassisType)) {
      for (const weapon of Object.values(WeaponType)) {
        commands.push({ kind: 'BuildRobot', baseId: 'base_1', order: { chassis, weapon }, front: false });
      }
    }
    expect(roundTrip(commands).commands).toEqual(commands);
  });

  it('survives an empty batch — the per-tick heartbeat', () => {
    expect(roundTrip([]).commands).toEqual([]);
  });

  it('preserves coordinates exactly (f64, not f32)', () => {
    // A value that f32 cannot hold: rounding it would put the two peers on
    // different worlds a few ticks later.
    const point = { x: 1234.5678901234567, y: 0.1 + 0.2 };
    const decoded = roundTrip([{ kind: 'MoveRobots', robotIds: ['robot_1'], point }]).commands[0];
    expect((decoded as { point: { x: number; y: number } }).point).toEqual(point);
  });
});

describe('tick frame round-trip', () => {
  it('carries the tick number and drone input', () => {
    const drone: DroneControl = { dir: { x: -0.6, y: 0.8 }, possessPulse: true, firePulse: false };
    const decoded = roundTrip([], drone, 4242);
    expect(decoded.tick).toBe(4242);
    expect(decoded.drone).toEqual(drone);
  });

  it('carries the desync probe when one is attached, and null when not', () => {
    const check = { tick: 120, hash: 0xdeadbeef };
    const withCheck = encodeTick(130, { commands: [], drone: IDLE_DRONE, pauseToggle: false }, check);
    const decoded = decodeServerMessage(toArrayBuffer(withCheck));
    expect(decoded).toMatchObject({ type: 'tick', check });
    expect(roundTrip([]).check).toBeNull();
  });

  // The pause pulse rides the same per-tick frame as everything else, which is
  // what applies it on the same tick in both simulations.
  it('carries the pause pulse in both states', () => {
    expect(roundTrip([], IDLE_DRONE, 7, true).pauseToggle).toBe(true);
    expect(roundTrip([], IDLE_DRONE, 7, false).pauseToggle).toBe(false);
  });
});

describe('relay messages', () => {
  it('round-trips created', () => {
    const bytes = frame(MessageTag.Created, encodeCreatedMessage({ roomCode: 'AB7K' }));
    expect(decodeServerMessage(toArrayBuffer(bytes))).toEqual({ type: 'created', roomCode: 'AB7K' });
  });

  it('round-trips start, mapping the wire tag back to a MapSize', () => {
    const chatId = 'a'.repeat(32);
    // Unlike everything else in `start`, this one differs between the two peers —
    // it names the seat, which is what lets only its holder reclaim it.
    const resumeToken = 'b'.repeat(32);
    const bytes = frame(
      MessageTag.Start,
      encodeStartMessage({ seed: 0xfeedface, mapSize: WireMapSize.Large, aiCount: 2, chatId, resumeToken }),
    );
    expect(decodeServerMessage(toArrayBuffer(bytes))).toEqual({
      type: 'start',
      seed: 0xfeedface,
      mapSize: MapSize.Large,
      aiCount: 2,
      chatId,
      resumeToken,
    });
  });

  it('clamps a bot count the map has no corners for', () => {
    const start = { seed: 1, mapSize: WireMapSize.Small, aiCount: 200, chatId: '', resumeToken: '' };
    const bytes = frame(MessageTag.Start, encodeStartMessage(start));
    expect(decodeServerMessage(toArrayBuffer(bytes))).toMatchObject({ aiCount: 2 });
  });

  // Chat runs on a socket of its own; the shared tag space is what makes this
  // reachable at all, and dropping the frame is the whole of the response.
  it('ignores a chat frame that arrives on the game socket', () => {
    for (const tag of [MessageTag.ChatSend, MessageTag.ChatHistory, MessageTag.ChatPosted, MessageTag.ChatPresence]) {
      expect(decodeServerMessage(toArrayBuffer(frame(tag, new Uint8Array([0]))))).toBeNull();
    }
  });

  it('round-trips opponentLeft as a bare tag byte', () => {
    const bytes = frame(MessageTag.OpponentLeft);
    expect(bytes).toHaveLength(1);
    expect(decodeServerMessage(toArrayBuffer(bytes))).toEqual({ type: 'opponentLeft' });
  });

  it('round-trips error', () => {
    const payload = encodeErrorMessage({ code: ErrorCode.RoomNotFound, message: 'No open room with that code' });
    const bytes = frame(MessageTag.Error, payload);
    expect(decodeServerMessage(toArrayBuffer(bytes))).toEqual({
      type: 'error',
      code: ErrorCode.RoomNotFound,
      message: 'No open room with that code',
    });
  });
});

describe('framing', () => {
  it('puts the tag in the leading octet, where the relay reads it', () => {
    const bytes = encodeTick(1, { commands: [], drone: IDLE_DRONE, pauseToggle: false }, null);
    expect(bytes[0]).toBe(MessageTag.Tick);
    expect(tagOf(toArrayBuffer(bytes))).toBe(MessageTag.Tick);
  });

  it('leaves the payload untouched behind the tag', () => {
    const payload = encodeCreatedMessage({ roomCode: 'ZZZZ' });
    const bytes = frame(MessageTag.Created, payload);
    expect(bytes.subarray(1)).toEqual(payload);
  });

  it('reports no tag for an empty or unknown frame', () => {
    expect(tagOf(new ArrayBuffer(0))).toBeNull();
    expect(tagOf(Uint8Array.of(99).buffer)).toBeNull();
  });
});

describe('malformed input', () => {
  it('returns null rather than throwing', () => {
    const good = encodeTick(
      1,
      {
        commands: [{ kind: 'AttackTarget', robotIds: ['robot_1'], targetId: 'base_1' }],
        drone: IDLE_DRONE,
        pauseToggle: false,
      },
      null,
    );

    expect(decodeServerMessage(new ArrayBuffer(0))).toBeNull(); // empty
    expect(decodeServerMessage(Uint8Array.of(99, 1, 2, 3).buffer)).toBeNull(); // unknown tag
    expect(decodeServerMessage(toArrayBuffer(good.subarray(0, 4)))).toBeNull(); // truncated
    expect(decodeServerMessage(Uint8Array.of(MessageTag.Tick).buffer)).toBeNull(); // tag with no payload

    // Trailing junk is refused too: the decoder insists it consumed every byte,
    // which is what stops a smuggled second message from riding along.
    const padded = new Uint8Array(good.length + 4);
    padded.set(good);
    expect(decodeServerMessage(toArrayBuffer(padded))).toBeNull();
  });

  it('refuses random bytes under every valid tag', () => {
    for (const tag of Object.values(MessageTag)) {
      const junk = new Uint8Array(24).fill(0xff);
      junk[0] = tag;
      expect(decodeServerMessage(toArrayBuffer(junk))).toBeNull();
    }
  });
});

describe('mapSizeToQueryParam', () => {
  it('spells every map size the way the handshake URL expects', () => {
    expect(Object.values(MapSize).map(mapSizeToQueryParam)).toEqual(['small', 'medium', 'large']);
  });
});
