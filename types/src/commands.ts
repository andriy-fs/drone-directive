import type { BuildOrder, Vec2 } from './entities';
import type { TaskType } from './enums';

/**
 * Intents pushed from React/UI onto the store's command queue and drained by the
 * game loop each tick. The engine resolves live world state when applying them
 * (e.g. a Guard's post is the robot's current position at apply time; a build is
 * only enqueued if the owner can afford it), so a command carries intent.
 */
export type Command =
  | { kind: 'AssignTask'; robotId: string; task: TaskType }
  | { kind: 'BuildRobot'; baseId: string; order: BuildOrder }
  /** Repeat this order continuously (player single-model auto-build), or null = off. */
  | { kind: 'SetAutoBuild'; baseId: string; order: BuildOrder | null }
  /**
   * The program a base stamps on the robots it produces, or null = none (they
   * roll out Idle). Two states, not the three a `BuildOrder.task` has: an order
   * may defer to this setting, but the setting itself has nothing to defer to.
   */
  | { kind: 'SetDefaultTask'; baseId: string; task: TaskType | null }
  /** Move the given robots to `point` in a compact formation (right-click move). */
  | { kind: 'MoveRobots'; robotIds: string[]; point: Vec2 }
  /** Order the given robots to focus-fire a specific target — robot or base (right-click attack). */
  | { kind: 'AttackTarget'; robotIds: string[]; targetId: string }
  /**
   * Where a base's newly produced robots gather, or null = no rally point. Only
   * Idle and Guard units obey it: every other program's own priority takes over
   * on the tick they roll out, so a rally point would never survive it.
   */
  | { kind: 'SetRallyPoint'; baseId: string; point: Vec2 | null }
  /**
   * Raise a base's one-shot energy dome. No payload beyond the base: activation
   * is free, and the engine deliberately does not re-check the threat condition
   * the HUD gates the button on. A client that pre-casts only wastes its own
   * single charge — which punishes itself — whereas silently dropping a
   * panic-button press would be indistinguishable from the game having frozen.
   */
  | { kind: 'ActivateShield'; baseId: string };
