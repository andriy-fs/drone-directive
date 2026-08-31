import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { getBuildPreset } from '../../config/buildPresets';
import type { BuildOrder, Vec2 } from '@drone-directive/types/entities';
import { Owner, TaskType } from '@drone-directive/types/enums';
import { clamp } from '../../utils/math';
import type { Rng } from '../../utils/rng';
import type { BaseEntity } from '../ecs/archetypes';
import { spawnRobot } from '../ecs/factory';
import { bases, robots } from '../ecs/queries';
import type { EcsWorld } from '../ecs/world';
import { buildCost, canAfford, spend } from '../economy';
import type { GameContext } from '../game/context';
import { isTaskBlockedForWeapon, scriptForTask } from '../tasks/taskDefinitions';
import { setGoal } from './movement';

/**
 * Robots a side already has committed: living units + everything still queued.
 *
 * Takes the world rather than a `GameContext` so the read is available to a
 * *reader* of the simulation and not only to a system inside it — the radio
 * director watches the cap from the Pixi layer, and has no context to hand over.
 */
export function sideRobotLoad(world: EcsWorld, owner: Owner): number {
  let n = 0;
  for (const e of robots(world).entities) if (e.owner === owner) n++;
  for (const b of bases(world).entities) {
    if (b.owner === owner) n += b.production.queue.length;
  }
  return n;
}

/** Whether a side is at the shared per-side robot cap (no more should be queued). */
export function atRobotCap(world: EcsWorld, owner: Owner): boolean {
  return sideRobotLoad(world, owner) >= gameConfig.production.maxRobots;
}

/**
 * How long one order takes to assemble, in seconds — the weapon's own figure, so
 * pace is a per-model property the way price already is (`buildCost` in
 * `economy.ts`, which this sits alongside rather than inside: time is not a
 * resource).
 *
 * Only the head of the queue is ever asked, and only while it is being built. That
 * is safe because the head cannot change under a part-built order: cancelling it is
 * the one thing that removes it, and that path resets `progress` and `funded`
 * together (see `applyCommand`).
 */
export function buildTimeFor(order: BuildOrder): number {
  return gameConfig.production.weaponBuildTime[order.weapon];
}

/**
 * Auto-build refill + timed production for every base. Refill sources, when the
 * queue empties: `autoBuild` repeats a single fixed order (player's chosen
 * model), else `autoBuildPreset` cycles a named series (AI only). A produced
 * robot's program is its order's own `task` when set, else the base's
 * `production.defaultTask` (see `BuildOrder`). A `production.rally` point sends
 * the Idle and Guard units it produces to gather there. Fully owner-agnostic:
 * the only limit on a refill is the per-side robot cap.
 *
 * ## Money is taken at the gate, not at the door
 *
 * **Queueing is free and building is what costs** (`Production.funded`). An order
 * sits in the queue whatever the balance; when it reaches the head, the side pays
 * for it and the clock starts. Short of the price, the whole queue simply waits.
 *
 * That is what lets the build dialog offer an order the player cannot afford yet
 * — the alternative, and what this used to be, is a disabled button and a player
 * watching a number climb. It also means the price is the one in force when the
 * machine is actually built, not when it was thought of.
 *
 * Two consequences worth naming. A queued order still counts against the per-side
 * cap (`sideRobotLoad`), so the cap — not the wallet — is now the only thing that
 * refuses an order outright. And a preset series no longer stalls on a step it
 * cannot afford: it enqueues and waits, where it used to retry the same step
 * until the money arrived. The pacing is the same, because a refill only happens
 * on an empty queue.
 */
export function productionSystem(ctx: GameContext, dt: number): void {
  for (const base of bases(ctx.world)) {
    const prod = base.production;

    // Auto-build: refill an empty queue while under the side cap. Affordability
    // is no longer a condition — the refill queues, and the gate below waits.
    if (prod.queue.length === 0 && !atRobotCap(ctx.world, base.owner)) {
      if (prod.autoBuild) {
        tryEnqueue(base, prod.autoBuild);
      } else if (prod.autoBuildPreset) {
        // Preset series (AI): cycle one step forward on a successful enqueue.
        const sequence = getBuildPreset(prod.autoBuildPreset).sequence;
        const order = sequence[prod.autoBuildStep % sequence.length];
        if (tryEnqueue(base, order)) {
          prod.autoBuildStep = (prod.autoBuildStep + 1) % sequence.length;
        }
      }
    }

    if (prod.queue.length === 0) {
      prod.progress = 0;
      continue;
    }

    // The gate: nothing accrues until the order in front has been paid for. A
    // side that cannot cover it keeps its queue and its place, and starts the
    // moment income catches up.
    if (!prod.funded) {
      const cost = buildCost(prod.queue[0]);
      if (!canAfford(ctx.resources, base.owner, cost)) continue;
      spend(ctx.resources, base.owner, cost);
      prod.funded = true;
    }

    prod.progress += dt / buildTimeFor(prod.queue[0]);
    if (prod.progress >= 1) {
      const order = prod.queue.shift();
      prod.progress = 0;
      prod.funded = false;
      if (!order) continue;
      const pos = spawnPointFor(base, ctx.rng);
      const robot = spawnRobot(ctx.world, base.owner, pos, order.chassis, order.weapon);
      const task = order.task !== undefined ? order.task : prod.defaultTask;
      // A radar has no weapon — an attack-oriented task/default is refused, so it
      // spawns on the factory default (Idle) instead of marching off pointlessly.
      if (task && !isTaskBlockedForWeapon(order.weapon, task)) {
        // A rally point *is* the guard's post: it patrols the flag rather than
        // the factory door, and walks there on its own to take up station.
        const post = prod.rally && task === TaskType.Guard ? prod.rally : robot.position;
        robot.script = scriptForTask(post, task);
      }
      // Idle has no objective of its own, so it needs an explicit walk order —
      // its `idle` action leaves the goal untouched, the same mechanism that
      // makes a right-click move stick. Guard is already covered by its post
      // above; every other program overwrites the goal on this very tick
      // (taskSystem runs after productionSystem), so a rally point is moot.
      // Keyed on the *resolved* program: a radar refused an attack task falls
      // back to Idle and should rally like any other Idle unit.
      if (prod.rally && robot.script.programId === TaskType.Idle) {
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

/**
 * Queues one build order. Always succeeds — the caller has already checked the cap,
 * and there is nothing else left to refuse it now that the money is taken at the
 * head of the queue rather than here.
 *
 * Kept as a function, and still returning a boolean, because the preset caller
 * reads it: `autoBuildStep` advances on an enqueue, and burying that in a bare
 * `push` would hide which of the two refill paths moved the series on.
 */
function tryEnqueue(base: BaseEntity, order: BuildOrder): boolean {
  base.production.queue.push({ ...order });
  return true;
}

/** A point just outside the base footprint (toward the field), with jitter. */
function spawnPointFor(base: BaseEntity, rng: Rng): Vec2 {
  const { tilePx, height } = gameConfig.grid;
  const bp = base.position;
  const half = (base.footprint * tilePx) / 2;
  const offset = half + gameConfig.production.spawnOffsetTiles * tilePx;
  const towardCentre = bp.y < (height * tilePx) / 2 ? 1 : -1;
  const jitter = (rng.next() - 0.5) * tilePx * 2;
  return {
    x: clamp(bp.x + jitter, 0, worldPixelSize.width),
    y: clamp(bp.y + offset * towardCentre, 0, worldPixelSize.height),
  };
}
