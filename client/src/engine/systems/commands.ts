import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Command } from '@drone-directive/types/commands';
import type { Vec2 } from '@drone-directive/types/entities';
import type { Owner } from '@drone-directive/types/enums';
import { clamp } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, makeAttackTarget, makeIdle, scriptForTask } from '../tasks/taskDefinitions';
import { setGoal } from './movement';
import { atRobotCap } from './production';
import { findById } from './targeting';

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
    case 'SetAutoBuild':
    case 'SetRallyPoint':
      return ownedBySide(command.baseId);
    case 'MoveRobots':
    case 'AttackTarget':
      return command.robotIds.every(ownedBySide);
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
      const robot = findById(ctx, command.robotId);
      // A radar has no weapon to attack with — refuse the order and leave its
      // current directive untouched, rather than march it uselessly forward.
      if (robot?.robot && robot.position && !isTaskBlockedForWeapon(robot.weaponType, command.task)) {
        robot.script = scriptForTask(robot.position, command.task);
      }
      break;
    }
    case 'BuildRobot': {
      const base = findById(ctx, command.baseId);
      if (!base?.base || !base.production || !base.owner) break;
      if (atRobotCap(ctx, base.owner)) break; // at the per-side cap
      const cost = buildCost(command.order);
      if (!canAfford(ctx.resources, base.owner, cost)) break;
      spend(ctx.resources, base.owner, cost);
      base.production.queue.push(command.order);
      break;
    }
    case 'SetAutoBuild': {
      const base = findById(ctx, command.baseId);
      if (base?.production) base.production.autoBuild = command.order;
      break;
    }
    case 'MoveRobots': {
      const robots = command.robotIds
        .map((id) => findById(ctx, id))
        .filter((e): e is Entity => !!e?.robot && (e.hp ?? 0) > 0 && !!e.position);
      moveInFormation(ctx, robots, command.point);
      break;
    }
    case 'AttackTarget': {
      for (const id of command.robotIds) {
        const robot = findById(ctx, id);
        if (robot?.robot && (robot.hp ?? 0) > 0) {
          robot.script = makeAttackTarget(command.targetId);
          robot.targetId = undefined;
        }
      }
      break;
    }
    case 'SetRallyPoint': {
      const base = findById(ctx, command.baseId);
      if (!base?.production) break;
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
  }
}

/** Moves `robots` to `point` in a compact grid formation (shared move-order logic). */
function moveInFormation(ctx: GameContext, robots: Entity[], point: Vec2): void {
  const cols = Math.ceil(Math.sqrt(robots.length));
  const rows = Math.ceil(robots.length / cols);
  const spacing = gameConfig.grid.tilePx * 1.2;

  robots.forEach((robot, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = (col - (cols - 1) / 2) * spacing;
    const oy = (row - (rows - 1) / 2) * spacing;
    robot.script = makeIdle();
    robot.targetId = undefined;
    setGoal(ctx, robot, clamp(point.x + ox, 0, worldPixelSize.width), clamp(point.y + oy, 0, worldPixelSize.height));
  });
}
