import * as wire from '@drone-directive/protocol/codec';
import type { Command } from '@drone-directive/types/commands';
import type { BuildOrder } from '@drone-directive/types/entities';
import {
  CHASSIS_FROM_WIRE,
  CHASSIS_TO_WIRE,
  TASK_FROM_BUILD_TASK,
  TASK_FROM_WIRE,
  TASK_TO_BUILD_TASK,
  TASK_TO_WIRE,
  WEAPON_FROM_WIRE,
  WEAPON_TO_WIRE,
} from './enums';

/** Translation between the game's `Command`/`BuildOrder` and their wire counterparts. */

function buildTaskToWire(task: BuildOrder['task']): wire.BuildTask {
  if (task === undefined) return wire.BuildTask.Unspecified;
  if (task === null) return wire.BuildTask.None;
  return TASK_TO_BUILD_TASK[task];
}

function buildOrderToWire(order: BuildOrder): wire.BuildOrder {
  return {
    chassis: CHASSIS_TO_WIRE[order.chassis],
    weapon: WEAPON_TO_WIRE[order.weapon],
    task: buildTaskToWire(order.task),
  };
}

function buildOrderFromWire(order: wire.BuildOrder): BuildOrder {
  const chassis = CHASSIS_FROM_WIRE[order.chassis];
  const weapon = WEAPON_FROM_WIRE[order.weapon];
  // `Unspecified` has to leave the key off entirely, not set it to undefined:
  // `production` distinguishes "absent" from "explicitly none" by key presence.
  if (order.task === wire.BuildTask.Unspecified) return { chassis, weapon };
  return { chassis, weapon, task: order.task === wire.BuildTask.None ? null : TASK_FROM_BUILD_TASK[order.task] };
}

export function commandToWire(command: Command): wire.Command {
  switch (command.kind) {
    case 'AssignTask':
      return { tag: 'AssignTask', robotId: command.robotId, task: TASK_TO_WIRE[command.task] };
    case 'BuildRobot':
      return { tag: 'BuildRobot', baseId: command.baseId, order: buildOrderToWire(command.order) };
    case 'SetAutoBuild':
      return {
        tag: 'SetAutoBuild',
        baseId: command.baseId,
        order: command.order === null ? null : buildOrderToWire(command.order),
      };
    case 'MoveRobots':
      return { tag: 'MoveRobots', robotIds: command.robotIds, point: { x: command.point.x, y: command.point.y } };
    case 'AttackTarget':
      return { tag: 'AttackTarget', robotIds: command.robotIds, targetId: command.targetId };
    case 'SetRallyPoint':
      return {
        tag: 'SetRallyPoint',
        baseId: command.baseId,
        point: command.point === null ? null : { x: command.point.x, y: command.point.y },
      };
    case 'ActivateShield':
      return { tag: 'ActivateShield', baseId: command.baseId };
    case 'SetDefaultTask':
      return {
        tag: 'SetDefaultTask',
        baseId: command.baseId,
        task: command.task === null ? null : TASK_TO_WIRE[command.task],
      };
  }
}

export function commandFromWire(command: wire.Command): Command {
  switch (command.tag) {
    case 'AssignTask':
      return { kind: 'AssignTask', robotId: command.robotId, task: TASK_FROM_WIRE[command.task] };
    case 'BuildRobot':
      return { kind: 'BuildRobot', baseId: command.baseId, order: buildOrderFromWire(command.order) };
    case 'SetAutoBuild':
      return {
        kind: 'SetAutoBuild',
        baseId: command.baseId,
        order: command.order === null ? null : buildOrderFromWire(command.order),
      };
    case 'MoveRobots':
      // The generated lists are readonly; the engine mutates its own, so copy.
      return { kind: 'MoveRobots', robotIds: [...command.robotIds], point: { ...command.point } };
    case 'AttackTarget':
      return { kind: 'AttackTarget', robotIds: [...command.robotIds], targetId: command.targetId };
    case 'SetRallyPoint':
      // The generated point is readonly; the engine keeps its own, so copy.
      return {
        kind: 'SetRallyPoint',
        baseId: command.baseId,
        point: command.point === null ? null : { ...command.point },
      };
    // Nothing to copy: the only fields are a string and a scalar enum.
    case 'ActivateShield':
      return { kind: 'ActivateShield', baseId: command.baseId };
    case 'SetDefaultTask':
      return {
        kind: 'SetDefaultTask',
        baseId: command.baseId,
        task: command.task === null ? null : TASK_FROM_WIRE[command.task],
      };
  }
}
