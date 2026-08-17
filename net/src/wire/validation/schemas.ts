import type { Command } from '@drone-directive/types/commands';
import type { DroneControl } from '@drone-directive/types/entities';
import { ChassisType, TaskType, WeaponType } from '@drone-directive/types/enums';
import * as v from 'valibot';

/**
 * The rules themselves. Everything here is a valibot schema — a value, not a
 * behaviour; deciding what to do with a failure is `parser.ts`'s job.
 */

/**
 * The match-dependent half of the rules, supplied by the host application. Read
 * fresh on every validation: the map is resized between matches, and a stale
 * bound would either reject legal orders or admit impossible ones.
 */
export interface CommandLimits {
  /** Map width in world pixels; a move order beyond it is refused. */
  worldWidth: number;
  /** Map height in world pixels. */
  worldHeight: number;
  /**
   * Most robots one command may name. A command only ever acts on one side's
   * units, and a side is capped, so anything longer is not a real order.
   */
  maxRobots: number;
}

/** Entity ids are short and generated (`robot_7`, `base_1`). */
const MAX_ID_LENGTH = 64;

/**
 * Ids stay opaque here: resolving one against the world (and checking the sender
 * actually owns it) is the game's job — `isCommandFrom`/`findById` — and a format
 * regex would only couple this layer to the id generator for nothing.
 */
const idSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(MAX_ID_LENGTH));

/** `v.number()` already rejects NaN; `finite` is what keeps out ±Infinity. */
const coordSchema = v.pipe(v.number(), v.finite(), v.minValue(0));

const pointSchema = v.object({ x: coordSchema, y: coordSchema });

/**
 * `task` is tri-state and stays that way: absent = fall back to the base's
 * `defaultTask`, `null` = explicitly no program, a `TaskType` = that program.
 */
const buildOrderSchema = v.object({
  chassis: v.picklist(Object.values(ChassisType)),
  weapon: v.picklist(Object.values(WeaponType)),
  task: v.optional(v.nullable(v.picklist(Object.values(TaskType)))),
});

/**
 * Keyed by `Command['kind']` so the domain type drives the schema: add a variant
 * to `@drone-directive/types/commands` and this object stops compiling until it
 * gets one too.
 *
 * Built per call because two variants depend on `limits`. The schemas are cheap
 * objects and a tick carries a handful of commands at most, so rebuilding them
 * costs far less than the bug of validating against a stale map.
 */
export function commandSchemaFor(limits: CommandLimits): v.GenericSchema<unknown, Command> {
  const robotIdsSchema = v.pipe(v.array(idSchema), v.nonEmpty(), v.maxLength(limits.maxRobots));
  const worldPointSchema = v.pipe(
    pointSchema,
    v.check((p) => p.x <= limits.worldWidth && p.y <= limits.worldHeight, 'point outside the map'),
  );

  const commandSchemas = {
    AssignTask: v.object({
      kind: v.literal('AssignTask'),
      robotId: idSchema,
      task: v.picklist(Object.values(TaskType)),
    }),
    BuildRobot: v.object({
      kind: v.literal('BuildRobot'),
      baseId: idSchema,
      order: buildOrderSchema,
    }),
    SetAutoBuild: v.object({
      kind: v.literal('SetAutoBuild'),
      baseId: idSchema,
      order: v.nullable(buildOrderSchema),
    }),
    MoveRobots: v.object({
      kind: v.literal('MoveRobots'),
      robotIds: robotIdsSchema,
      point: worldPointSchema,
    }),
    AttackTarget: v.object({
      kind: v.literal('AttackTarget'),
      robotIds: robotIdsSchema,
      targetId: idSchema,
    }),
    SetRallyPoint: v.object({
      kind: v.literal('SetRallyPoint'),
      baseId: idSchema,
      point: v.nullable(worldPointSchema),
    }),
    ActivateShield: v.object({
      kind: v.literal('ActivateShield'),
      baseId: idSchema,
    }),
    // Nullable but never absent: a base default has only "this program" or "none".
    SetDefaultTask: v.object({
      kind: v.literal('SetDefaultTask'),
      baseId: idSchema,
      task: v.nullable(v.picklist(Object.values(TaskType))),
    }),
  } satisfies Record<Command['kind'], v.GenericSchema>;

  // The annotation is the other half of the guarantee: the parsed result must be
  // assignable to the game's own `Command`, so a schema that drifts from the
  // domain type fails the build instead of letting a wrong shape through.
  //
  // This list, unlike the record above, is NOT checked for completeness — a kind
  // missing here compiles and then silently vanishes at runtime, working
  // perfectly offline and never arriving online. `validation.test.ts` walks the
  // exhaustive `Record<Command['kind'], Command>` sample precisely to catch that.
  return v.variant('kind', [
    commandSchemas.AssignTask,
    commandSchemas.BuildRobot,
    commandSchemas.SetAutoBuild,
    commandSchemas.MoveRobots,
    commandSchemas.AttackTarget,
    commandSchemas.SetRallyPoint,
    commandSchemas.ActivateShield,
    commandSchemas.SetDefaultTask,
  ]);
}

/**
 * The observer drone's per-tick input. `dir` is a unit vector or zero, so anything
 * outside [-1, 1] is not something a correct client sends — and a NaN here would
 * walk the drone off the map and poison the world hash.
 *
 * This is the game's own shape, not the wire's: renaming the wire's
 * `possess`/`fire` to `possessPulse`/`firePulse` is the codec's job, and by the
 * time input reaches here it already speaks the game's vocabulary.
 */
const droneAxisSchema = v.pipe(v.number(), v.finite(), v.minValue(-1), v.maxValue(1));

export const droneControlSchema: v.GenericSchema<unknown, DroneControl> = v.object({
  dir: v.object({ x: droneAxisSchema, y: droneAxisSchema }),
  possessPulse: v.boolean(),
  firePulse: v.boolean(),
});
