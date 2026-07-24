import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { getBuildPreset } from '../../config/buildPresets';
import type { BuildOrder, Vec2 } from '../../types/entities';
import { Owner } from '../../types/enums';
import { clamp, distance } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import { spawnRobot } from '../ecs/factory';
import type { Entity } from '../ecs/entity';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, scriptForTask } from '../tasks/taskDefinitions';

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
 * `production.defaultTask` (see `BuildOrder`). Owner-agnostic otherwise.
 */
export function productionSystem(ctx: GameContext, dt: number): void {
  for (const base of ctx.world.with('base', 'position', 'production')) {
    const prod = base.production!;

    // Auto-build: refill an empty queue if affordable and under the side cap.
    if (prod.queue.length === 0 && !atRobotCap(ctx, base.owner!)) {
      if (prod.autoBuild) {
        // Balance: the player's continuous auto-build only runs while the observer
        // drone is docked on the base; fly it away and only manual "build once" works.
        if (base.owner !== Owner.Player || droneDocked(ctx, base)) tryEnqueue(ctx, base, prod.autoBuild);
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
      if (task && !isTaskBlockedForWeapon(order.weapon, task)) robot.script = scriptForTask(robot.position!, task);
      ctx.bus.emit('entitySpawned', {
        id: robot.id,
        kind: 'robot',
        owner: base.owner,
      });
    }
  }
}

/**
 * Whether the player's observer drone is docked on/near `base` (auto-build gate).
 * With no drone present it can't be "away", so this reports docked — the gate
 * only bites once a drone exists and has flown clear of the base.
 */
function droneDocked(ctx: GameContext, base: Entity): boolean {
  const drone = ctx.world.with('drone', 'position').entities[0];
  if (!drone?.position || !base.position) return true;
  return distance(drone.position.x, drone.position.y, base.position.x, base.position.y) <= gameConfig.drone.dockRadius;
}

/**
 * HUD helper: true when the player base wants to auto-build but its drone is
 * away, so continuous production is currently suppressed (only manual builds run).
 */
export function playerAutoBuildSuppressed(ctx: GameContext): boolean {
  const base = ctx.world
    .with('base', 'production', 'position')
    .entities.find((b) => b.owner === Owner.Player && (b.hp ?? 0) > 0);
  if (!base?.production?.autoBuild) return false;
  return !droneDocked(ctx, base);
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
