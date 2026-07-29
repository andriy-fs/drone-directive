import { spawnExplosion } from '../ecs/factory';
import type { Entity, EntityKind } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { refreshNavObstacles } from '../navGrid';

/**
 * Removes robots/bases/drones with hp<=0, spawning an explosion and emitting
 * events. Clears dangling target references on survivors. Returns true if
 * anything died. A downed drone is replaced later by `droneRespawnSystem`,
 * which notices the side has no eye rather than being told from here.
 */
export function reapSystem(ctx: GameContext): boolean {
  const world = ctx.world;
  const dead: Entity[] = [];

  for (const e of world.with('position')) {
    if ((e.robot || e.base || e.drone) && (e.hp ?? 0) <= 0) dead.push(e);
  }
  if (dead.length === 0) return false;

  const deadIds = new Set(dead.map((e) => e.id));
  let baseDied = false;

  for (const e of dead) {
    const kind: EntityKind = e.base ? 'base' : e.drone ? 'drone' : 'robot';
    spawnExplosion(world, e.position!);
    ctx.bus.emit('entityDestroyed', {
      id: e.id,
      kind,
      owner: e.owner,
      pos: { x: e.position!.x, y: e.position!.y },
    });
    if (e.base && e.owner) {
      ctx.bus.emit('baseDestroyed', { owner: e.owner });
      baseDied = true;
    }
    world.remove(e);
  }

  // A destroyed base is no longer impassable — reopen its footprint for pathing.
  if (baseDied) refreshNavObstacles(ctx);

  // Clear references to destroyed entities on survivors.
  for (const r of world.with('robot')) {
    if (r.targetId && deadIds.has(r.targetId)) r.targetId = undefined;
    if (r.threat?.attackerId && deadIds.has(r.threat.attackerId)) r.threat.attackerId = undefined;
  }

  return true;
}
