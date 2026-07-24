import type { Command } from '../../types/commands';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { scriptForTask } from '../tasks/taskDefinitions';
import { atRobotCap } from './production';
import { findById } from './targeting';

/** Drains and applies queued UI intents (AssignTask / BuildRobot / SetAutoBuild). */
export function commandsSystem(ctx: GameContext): void {
  if (ctx.commands.length === 0) return;
  for (const command of ctx.commands) applyCommand(ctx, command);
  ctx.commands.length = 0;
}

function applyCommand(ctx: GameContext, command: Command): void {
  switch (command.kind) {
    case 'AssignTask': {
      const robot = findById(ctx, command.robotId);
      if (robot?.robot && robot.position) {
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
  }
}
