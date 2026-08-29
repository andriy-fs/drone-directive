import type { BuildOrder, Vec2 } from './entities';
import type { FormationType, TaskType } from './enums';

/**
 * Intents pushed from React/UI onto the store's command queue and drained by the
 * game loop each tick. The engine resolves live world state when applying them
 * (e.g. a Guard's post is the robot's current position at apply time; a build is
 * only enqueued if the owner can afford it), so a command carries intent.
 */
export type Command =
  | { kind: 'AssignTask'; robotId: string; task: TaskType }
  /**
   * Put one robot on a base's build queue.
   *
   * `front` is where in the queue: `false` joins the back, `true` jumps it and is
   * built next. **Next, not instead of** — the engine will not displace an order it
   * has already paid for and started, so a rush order costs the player nothing they
   * had already committed.
   *
   * Deliberately *not* gated on affordability, here or in the engine: a player who
   * cannot pay yet should be able to state the intent and let the factory act on it
   * when the bank catches up. The cost is taken when the order reaches the head of
   * the queue and building actually begins.
   */
  | { kind: 'BuildRobot'; baseId: string; order: BuildOrder; front: boolean }
  /**
   * Take one order back off a base's build queue.
   *
   * Carries **both** the position and the order that was there. The position is
   * what the player clicked; the order is what they meant, and the engine falls
   * back to the first matching one when a build finished between the snapshot the
   * dialog drew and the tick this lands on. Two identical orders are
   * interchangeable, so matching on value rather than on an identity of its own is
   * enough — and it keeps `BuildOrder` a plain value, which is what the whole
   * queue is made of.
   *
   * A cancelled order that had already been paid for is refunded; see
   * `productionSystem` on why the two can differ.
   */
  | { kind: 'CancelQueued'; baseId: string; index: number; order: BuildOrder }
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
  | { kind: 'ActivateShield'; baseId: string }
  /**
   * The shape the given robots hold from now on, or null = fall out of formation.
   * The command names a *selection*, not a standing squad: applying it stamps one
   * shared group id on everyone listed, and that group is only ever as alive as
   * its members. Where each robot stands inside the shape is deliberately absent
   * from the payload — the engine derives it from the unit's weapon every tick,
   * so the line re-dresses itself as members die instead of keeping their holes.
   */
  | { kind: 'SetFormation'; robotIds: string[]; formation: FormationType | null };
