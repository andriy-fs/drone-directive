import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { getBuildPreset } from '../../config/buildPresets';
import type { BuildOrder, Vec2 } from '@drone-directive/types/entities';
import { Owner, TaskType } from '@drone-directive/types/enums';
import { clamp } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import { spawnRobot } from '../ecs/factory';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, scriptForTask } from '../tasks/taskDefinitions';
import { setGoal } from './movement';

/** Robots a side already has committed: living units + everything still queued. */
export function sideRobotLoad(ctx: GameContext, owner: Owner): number {
  let n = ctx.world.with('robot').entities.filter((e) => e.owner === owner).length;
  for (const b of ctx.world.with('base', 'production').entities) {
    if (b.owner === owner) n += b.production!.queue.length;
  }
  return n;
}

/** Whether a side is at the shared per-side robot cap (no more should be queued). */
export function atRobotCap(ctx: GameContext, owner: Owner): boolean {
  return sideRobotLoad(ctx, owner) >= gameConfig.production.maxRobots;
}

/**
 * Auto-build refill + timed production for every base. Refill sources, when the
 * queue empties: `autoBuild` repeats a single fixed order (player's chosen
 * model), else `autoBuildPreset` cycles a named series (AI only). A produced
 * robot's program is its order's own `task` when set, else the base's
 * `production.defaultTask` (see `BuildOrder`). A `production.rally` point sends
 * the Idle and Guard units it produces to gather there. Fully owner-agnostic:
 * the only limits on a refill are affordability and the per-side robot cap.
 */
export function productionSystem(ctx: GameContext, dt: number): void {
  for (const base of ctx.world.with('base', 'position', 'production')) {
    const prod = base.production!;

    // Auto-build: refill an empty queue if affordable and under the side cap.
    if (prod.queue.length === 0 && !atRobotCap(ctx, base.owner!)) {
      if (prod.autoBuild) {
        tryEnqueue(ctx, base, prod.autoBuild);
      } else if (prod.autoBuildPreset) {
        // Preset series (AI): cycle one step forward on a successful enqueue.
        const sequence = getBuildPreset(prod.autoBuildPreset).sequence;
        const order = sequence[prod.autoBuildStep % sequence.length];
        if (tryEnqueue(ctx, base, order)) {
          prod.autoBuildStep = (prod.autoBuildStep + 1) % sequence.length;
        }
      }
    }

    if (prod.queue.length === 0) {
      prod.progress = 0;
      continue;
    }

    prod.progress += dt / gameConfig.production.buildTime;
    if (prod.progress >= 1) {
      const order = prod.queue.shift();
      prod.progress = 0;
      if (!order) continue;
      const pos = spawnPointFor(base, ctx.rng);
      const robot = spawnRobot(ctx.world, base.owner!, pos, order.chassis, order.weapon);
      const task = order.task !== undefined ? order.task : prod.defaultTask;
      // A radar has no weapon — an attack-oriented task/default is refused, so it
      // spawns on the factory default (Idle) instead of marching off pointlessly.
      if (task && !isTaskBlockedForWeapon(order.weapon, task)) {
        // A rally point *is* the guard's post: it patrols the flag rather than
        // the factory door, and walks there on its own to take up station.
        const post = prod.rally && task === TaskType.Guard ? prod.rally : robot.position!;
        robot.script = scriptForTask(post, task);
      }
      // Idle has no objective of its own, so it needs an explicit walk order —
      // its `idle` action leaves the goal untouched, the same mechanism that
      // makes a right-click move stick. Guard is already covered by its post
      // above; every other program overwrites the goal on this very tick
      // (taskSystem runs after productionSystem), so a rally point is moot.
      // Keyed on the *resolved* program: a radar refused an attack task falls
      // back to Idle and should rally like any other Idle unit.
      if (prod.rally && robot.script?.programId === TaskType.Idle) {
        setGoal(ctx, robot, prod.rally.x, prod.rally.y);
      }
      ctx.bus.emit('entitySpawned', {
        id: robot.id,
        kind: 'robot',
        owner: base.owner,
      });
    }
  }
}

/** Queues one build order if the base's owner can afford it; returns whether it did. */
function tryEnqueue(ctx: GameContext, base: Entity, order: BuildOrder): boolean {
  const cost = buildCost(order);
  if (!canAfford(ctx.resources, base.owner!, cost)) return false;
  spend(ctx.resources, base.owner!, cost);
  base.production!.queue.push({ ...order });
  return true;
}

/** A point just outside the base footprint (toward the field), with jitter. */
function spawnPointFor(base: Entity, rng: Rng): Vec2 {
  const { tilePx, height } = gameConfig.grid;
  const bp = base.position!;
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * tilePx) / 2;
  const offset = half + gameConfig.production.spawnOffsetTiles * tilePx;
  const towardCentre = bp.y < (height * tilePx) / 2 ? 1 : -1;
  const jitter = (rng.next() - 0.5) * tilePx * 2;
  return {
    x: clamp(bp.x + jitter, 0, worldPixelSize.width),
    y: clamp(bp.y + offset * towardCentre, 0, worldPixelSize.height),
  };
}
