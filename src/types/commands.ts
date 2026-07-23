import type { BuildOrder } from './entities';
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
  | { kind: 'SetAutoBuild'; baseId: string; order: BuildOrder | null };
