import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Command } from '../../types/commands';
import type { Vec2 } from '../../types/entities';
import { clamp } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, makeAttackTarget, makeIdle, scriptForTask } from '../tasks/taskDefinitions';
import { setGoal } from './movement';
import { atRobotCap } from './production';
import { findById } from './targeting';

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
