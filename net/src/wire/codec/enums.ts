import type { WireMapSize } from '@drone-directive/protocol';
import * as wire from '@drone-directive/protocol/codec';
import { ChassisType, FormationType, MapSize, TaskType, WeaponType } from '@drone-directive/types/enums';

/**
 * `Record<DomainValue, WireValue>` in one direction and its inverse in the other.
 * Written as exhaustive records so adding a member to `@drone-directive/types`
 * without adding it to the schema is a compile error, not a runtime surprise.
 */

export const CHASSIS_TO_WIRE: Record<ChassisType, wire.ChassisType> = {
  [ChassisType.Tracks]: wire.ChassisType.Tracks,
  [ChassisType.Wheels]: wire.ChassisType.Wheels,
  [ChassisType.Legs]: wire.ChassisType.Legs,
};

export const WEAPON_TO_WIRE: Record<WeaponType, wire.WeaponType> = {
  [WeaponType.None]: wire.WeaponType.None,
  [WeaponType.Cannon]: wire.WeaponType.Cannon,
  [WeaponType.Missiles]: wire.WeaponType.Missiles,
  [WeaponType.Bomb]: wire.WeaponType.Bomb,
  [WeaponType.Radar]: wire.WeaponType.Radar,
  [WeaponType.Ew]: wire.WeaponType.Ew,
  [WeaponType.Dew]: wire.WeaponType.Dew,
  [WeaponType.Fpv]: wire.WeaponType.Fpv,
};

export const TASK_TO_WIRE: Record<TaskType, wire.TaskType> = {
  [TaskType.Idle]: wire.TaskType.Idle,
  [TaskType.Guard]: wire.TaskType.Guard,
  [TaskType.AttackBase]: wire.TaskType.AttackBase,
  [TaskType.AttackRobots]: wire.TaskType.AttackRobots,
  [TaskType.Scout]: wire.TaskType.Scout,
  [TaskType.AttackTarget]: wire.TaskType.AttackTarget,
  [TaskType.Overwatch]: wire.TaskType.Overwatch,
  [TaskType.DefendBase]: wire.TaskType.DefendBase,
  [TaskType.GroupAttack]: wire.TaskType.GroupAttack,
};

export const FORMATION_TO_WIRE: Record<FormationType, wire.Formation> = {
  [FormationType.Column]: wire.Formation.Column,
  [FormationType.Line]: wire.Formation.Line,
  [FormationType.Wedge]: wire.Formation.Wedge,
  [FormationType.Box]: wire.Formation.Box,
  [FormationType.Spread]: wire.Formation.Spread,
};

/**
 * A build order's task is tri-state — absent (use the base's default), `null`
 * (explicitly none), or a program — and the wire flattens all three into one
 * enum, so the mapping is not symmetric with `TASK_TO_WIRE`.
 */
export const TASK_TO_BUILD_TASK: Record<TaskType, wire.BuildTask> = {
  [TaskType.Idle]: wire.BuildTask.Idle,
  [TaskType.Guard]: wire.BuildTask.Guard,
  [TaskType.AttackBase]: wire.BuildTask.AttackBase,
  [TaskType.AttackRobots]: wire.BuildTask.AttackRobots,
  [TaskType.Scout]: wire.BuildTask.Scout,
  [TaskType.AttackTarget]: wire.BuildTask.AttackTarget,
  [TaskType.Overwatch]: wire.BuildTask.Overwatch,
  [TaskType.DefendBase]: wire.BuildTask.DefendBase,
  [TaskType.GroupAttack]: wire.BuildTask.GroupAttack,
};

export const MAP_SIZE_TO_WIRE: Record<MapSize, wire.MapSize> = {
  [MapSize.Small]: wire.MapSize.Small,
  [MapSize.Medium]: wire.MapSize.Medium,
  [MapSize.Large]: wire.MapSize.Large,
};

/** Inverts an exhaustive domain→wire record; both sides are unique, so this is total. */
function invert<D extends string, W extends string>(table: Record<D, W>): Record<W, D> {
  const inverted = {} as Record<W, D>;
  for (const [domain, wireValue] of Object.entries(table) as [D, W][]) inverted[wireValue] = domain;
  return inverted;
}

export const CHASSIS_FROM_WIRE = invert(CHASSIS_TO_WIRE);
export const WEAPON_FROM_WIRE = invert(WEAPON_TO_WIRE);
export const TASK_FROM_WIRE = invert(TASK_TO_WIRE);
export const MAP_SIZE_FROM_WIRE = invert(MAP_SIZE_TO_WIRE);
export const TASK_FROM_BUILD_TASK = invert(TASK_TO_BUILD_TASK);
export const FORMATION_FROM_WIRE = invert(FORMATION_TO_WIRE);

/** The `mapSize` query param is still text (it precedes any message) — map it here too. */
const WIRE_MAP_SIZE_STRINGS: Record<MapSize, WireMapSize> = {
  [MapSize.Small]: 'small',
  [MapSize.Medium]: 'medium',
  [MapSize.Large]: 'large',
};

export function mapSizeToQueryParam(size: MapSize): WireMapSize {
  return WIRE_MAP_SIZE_STRINGS[size];
}
