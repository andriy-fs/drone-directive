import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Command } from '@drone-directive/types/commands';
import type { BuildOrder, Vec2 } from '@drone-directive/types/entities';
import type { FormationType, Owner } from '@drone-directive/types/enums';
import type { RobotScript } from '@drone-directive/types/tasks';
import { clamp, vecLength } from '../../utils/math';
import type { RobotEntity } from '../ecs/archetypes';
import { isAlive } from '../ecs/guards';
import { buildCost, refund } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, makeAttackTarget, makeIdle, scriptForTask } from '../tasks/taskDefinitions';
import { setGoal } from './movement';
import { formationSlots } from './task/formation';
import { centroidOf } from './task/roam';
import { atRobotCap } from './production';
import { raiseShield } from './combat/shield';
import { baseById, findById, livingDroneById, livingRobotById, robotById } from '../targeting';

/**
 * True when every entity a command *acts on* belongs to `side`. Commands are
 * applied by raw entity id (identically on both peers, which is what keeps a
 * networked match in sync), so nothing in `applyCommand` stops one client from
 * ordering the other's units around. The app layer screens each side's input
 * through this so a HUD bug can't turn into control of the opponent's army.
 *
 * `AttackTarget.targetId` is deliberately unchecked — that one names the enemy.
 */
export function isCommandFrom(ctx: GameContext, command: Command, side: Owner): boolean {
  const ownedBySide = (id: string) => findById(ctx, id)?.owner === side;
  switch (command.kind) {
    case 'AssignTask':
      return ownedBySide(command.robotId);
    case 'BuildRobot':
    case 'CancelQueued':
    case 'SetAutoBuild':
    case 'SetDefaultTask':
    case 'SetRallyPoint':
    case 'ActivateShield':
      return ownedBySide(command.baseId);
    case 'MoveRobots':
    case 'AttackTarget':
    case 'SetFormation':
      return command.robotIds.every(ownedBySide);
    case 'MoveDrone':
      return ownedBySide(command.droneId);
  }
}

/**
 * True for the commands a player may still issue while the world is stopped.
 *
 * A build queue is a list of intentions the factory has not acted on yet, so
 * editing it under pause changes nothing that is happening — `productionSystem`
 * is inside the tick and cannot advance. Settings on a building are the same
 * kind of thing. Orders to an army are not: "pause, hand every unit a target,
 * unpause" is a different game, and `ActivateShield` is a reaction to something
 * in flight — pausing to place the dome perfectly is exactly what pause is
 * stopped from doing.
 *
 * Applied where input is *sampled*, never where it is received: a command the
 * sender drops never reaches the wire, so the peers cannot disagree about it.
 *
 * Exhaustive `switch` with no `default`, like `isCommandFrom` — a new command
 * kind fails the build here until somebody decides which side of the line it is
 * on.
 */
export function isAllowedWhilePaused(kind: Command['kind']): boolean {
  switch (kind) {
    case 'BuildRobot':
    case 'CancelQueued':
    case 'SetAutoBuild':
    case 'SetDefaultTask':
    case 'SetRallyPoint':
      return true;
    case 'AssignTask':
    case 'MoveRobots':
    case 'MoveDrone':
    case 'AttackTarget':
    case 'SetFormation':
    case 'ActivateShield':
      return false;
  }
}

/** Drains and applies queued UI intents (task/build/move/attack). */
export function commandsSystem(ctx: GameContext): void {
  if (ctx.commands.length === 0) return;
  for (const command of ctx.commands) applyCommand(ctx, command);
  ctx.commands.length = 0;
}

function applyCommand(ctx: GameContext, command: Command): void {
  switch (command.kind) {
    case 'AssignTask': {
      const robot = robotById(ctx, command.robotId);
      // A radar has no weapon to attack with — refuse the order and leave its
      // current directive untouched, rather than march it uselessly forward.
      if (robot && !isTaskBlockedForWeapon(robot.weaponType, command.task)) {
        robot.script = preserveFormation(robot.script, scriptForTask(robot.position, command.task));
      }
      break;
    }
    case 'BuildRobot': {
      const base = baseById(ctx, command.baseId);
      if (!base) break;
      // The cap is the only thing that refuses an order outright. Affordability is
      // deliberately not checked: the cost is taken when the order reaches the head
      // of the queue (`productionSystem`), so a player may order what they cannot
      // yet pay for and let the factory act on it when the bank catches up.
      if (atRobotCap(ctx.world, base.owner)) break;
      const prod = base.production;
      // A queue jump goes in front of everything *waiting*, but never in front of
      // the order being built: that one has been paid for, and displacing it would
      // hand the player a different machine on someone else's progress and money.
      const at = command.front ? (prod.funded ? 1 : 0) : prod.queue.length;
      prod.queue.splice(at, 0, command.order);
      break;
    }
    case 'CancelQueued': {
      const base = baseById(ctx, command.baseId);
      if (!base) break;
      const prod = base.production;
      const same = (order: BuildOrder) =>
        order.chassis === command.order.chassis &&
        order.weapon === command.order.weapon &&
        order.task === command.order.task;
      // The clicked slot when it still holds what the player saw there, else the
      // first order that matches: a build can finish between the snapshot the
      // dialog drew and this tick, sliding everything up by one. Two identical
      // orders are interchangeable, so "the first match" is never the wrong robot
      // in any sense the player could tell.
      const at = prod.queue[command.index] !== undefined && same(prod.queue[command.index])
        ? command.index
        : prod.queue.findIndex(same);
      if (at < 0) break;
      const [removed] = prod.queue.splice(at, 1);
      // Cancelling the order being built gives the money back and stops the clock.
      // Anything further down the queue was never charged for — see
      // `productionSystem`, which pays at the head and nowhere else.
      if (at === 0 && prod.funded) {
        refund(ctx.resources, base.owner, buildCost(removed));
        prod.funded = false;
        prod.progress = 0;
      }
      break;
    }
    case 'SetAutoBuild': {
      const base = baseById(ctx, command.baseId);
      if (base) base.production.autoBuild = command.order;
      break;
    }
    case 'SetDefaultTask': {
      const base = baseById(ctx, command.baseId);
      // Nothing to clamp: the task is one of a closed set either way, and an
      // order carrying its own `task` still wins over this in `productionSystem`.
      if (base) base.production.defaultTask = command.task;
      break;
    }
    case 'MoveRobots': {
      const robots = command.robotIds.map((id) => livingRobotById(ctx, id)).filter((e) => e !== undefined);
      moveInFormation(ctx, robots, command.point);
      break;
    }
    case 'MoveDrone': {
      const drone = livingDroneById(ctx, command.droneId);
      if (!drone) break;
      // Clamped for the same reason as `SetRallyPoint`: only the online path runs
      // commands through the wire validator, so solo play has no bound on the
      // point. And an unclamped goal is worse here than there — `freeFly` clamps
      // the drone's *position* to the map, so a goal outside it is one the drone
      // can never reach: it would press against the edge under a standing order
      // that never completes.
      drone.drone.goal = {
        x: clamp(command.point.x, 0, worldPixelSize.width),
        y: clamp(command.point.y, 0, worldPixelSize.height),
      };
      break;
    }
    case 'AttackTarget': {
      for (const id of command.robotIds) {
        const robot = livingRobotById(ctx, id);
        if (robot) {
          robot.script = preserveFormation(robot.script, makeAttackTarget(command.targetId));
          robot.targetId = undefined;
        }
      }
      break;
    }
    case 'SetRallyPoint': {
      const base = baseById(ctx, command.baseId);
      if (!base) break;
      // Clamped here rather than trusted: only the online path runs commands
      // through the wire validator, so solo play has no bound on the point.
      base.production.rally = command.point
        ? {
            x: clamp(command.point.x, 0, worldPixelSize.width),
            y: clamp(command.point.y, 0, worldPixelSize.height),
          }
        : null;
      break;
    }
    case 'SetFormation': {
      const members = command.robotIds.map((id) => livingRobotById(ctx, id)).filter((e) => e !== undefined);
      // A group id derived from the ids themselves, so both peers name the same
      // group without either telling the other — and so re-issuing the same order
      // is idempotent rather than churning the group every click.
      const gid = command.formation === null ? undefined : groupIdFor(members.map((e) => e.id));
      for (const robot of members) {
        if (gid === undefined || command.formation === null) delete robot.script.blackboard.formation;
        else robot.script.blackboard.formation = { gid, type: command.formation };
      }
      break;
    }
    case 'ActivateShield': {
      const base = baseById(ctx, command.baseId);
      // Only what a check on world state can settle: it exists, it is a base, it
      // is alive — `raiseShield` owns the remaining "and the charge is unspent".
      // The threat condition the HUD gates the button on is deliberately NOT
      // re-checked here (see the command's doc in `@drone-directive/types`), and
      // ownership is `isCommandFrom`'s job, applied by the app bridge before
      // anything reaches this queue — in solo play too.
      if (base && isAlive(base)) raiseShield(ctx, base);
      break;
    }
  }
}

/**
 * A stable id for the group an order just formed, from the sorted member ids.
 * Deterministic on both peers by construction — nothing here reads the world, the
 * clock or the rng, which is what lets a networked match form groups without the
 * group itself ever going on the wire.
 */
function groupIdFor(ids: readonly string[]): string {
  const key = [...ids].sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `f_${(h >>> 0).toString(36)}`;
}

/**
 * Carries a robot's formation across an order that replaces its script outright.
 * Every command that hands out a new script builds it from scratch, so without
 * this the first directive change — or the first right-click — would silently
 * break up a formation the player set a moment ago. The shape is a property of
 * the selection, not of the job it happens to be doing.
 */
function preserveFormation(previous: RobotScript, next: RobotScript): RobotScript {
  const formation = previous.blackboard.formation;
  if (formation) next.blackboard.formation = formation;
  return next;
}

/**
 * Sends `robots` to `point` spread out rather than stacked on one coordinate.
 *
 * Two layouts, and which one applies is the player's choice made earlier: a
 * selection holding a formation marches to its slots around the destination, in
 * the shape and the marching order that formation implies, so a right-click does
 * not undo what the formation tiles just set up. Anything else falls back to the
 * plain index grid this has always used — it asks nothing of the units and is
 * still the right answer for a scratch selection.
 *
 * Either way the destination is a one-off: the script goes back to Idle, so the
 * goal survives the resolver (`applyOutcome` leaves a manual destination alone),
 * while formation keeping goes on dressing the group on the way there.
 */
function moveInFormation(ctx: GameContext, robots: RobotEntity[], point: Vec2): void {
  const type = robots[0]?.script.blackboard.formation?.type;
  const offsets = type !== undefined ? formationOffsets(robots, type, point) : gridOffsets(robots);

  robots.forEach((robot, i) => {
    const offset = offsets[i];
    robot.script = preserveFormation(robot.script, makeIdle());
    robot.targetId = undefined;
    setGoal(
      ctx,
      robot,
      clamp(point.x + offset.x, 0, worldPixelSize.width),
      clamp(point.y + offset.y, 0, worldPixelSize.height),
    );
  });
}

/** The plain square grid: no roles, no facing, one cell per robot in selection order. */
function gridOffsets(robots: readonly RobotEntity[]): Vec2[] {
  const cols = Math.ceil(Math.sqrt(robots.length));
  const rows = Math.ceil(robots.length / cols);
  const spacing = gameConfig.grid.tilePx * 1.2;

  return robots.map((_, i) => ({
    x: ((i % cols) - (cols - 1) / 2) * spacing,
    y: (Math.floor(i / cols) - (rows - 1) / 2) * spacing,
  }));
}

/**
 * The formation's own slots, rotated to face the way the group is being sent —
 * so a line ordered across the map arrives abreast of the enemy rather than
 * side-on, and the gunners are the ones facing it.
 */
function formationOffsets(robots: readonly RobotEntity[], type: FormationType, point: Vec2): Vec2[] {
  const slots = formationSlots(robots, type);
  const from = centroidOf(robots);
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  const len = vecLength(dx, dy);
  // Ordered onto the spot it already occupies: any axis will do, so take the
  // world's rather than dividing by zero.
  const fx = len < 1e-6 ? 1 : dx / len;
  const fy = len < 1e-6 ? 0 : dy / len;

  return robots.map((robot) => {
    const slot = slots.get(robot.id);
    if (!slot) return { x: 0, y: 0 };
    return { x: fx * slot.ax - fy * slot.ay, y: fy * slot.ax + fx * slot.ay };
  });
}
