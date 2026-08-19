import { gameConfig } from '../../config/gameConfig';
import type { Positioned } from '../ecs/archetypes';
import { spawnExplosion } from '../ecs/factory';
import type { EntityKind } from '../ecs/entity';
import { positioned, robots } from '../ecs/queries';
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
  const dead: Positioned[] = [];

  for (const e of positioned(world)) {
    if ((e.robot || e.base || e.drone) && (e.hp ?? 0) <= 0) dead.push(e);
  }
  if (dead.length === 0) return false;

  const deadIds = new Set(dead.map((e) => e.id));
  let baseDied = false;

  for (const e of dead) {
    const kind: EntityKind = e.base ? 'base' : e.drone ? 'drone' : 'robot';
    // A base is the end of the match, not one more casualty — it dies wide and
    // slow so the outcome transition has something to hold on.
    const isBase = kind === 'base';
    spawnExplosion(
      world,
      e.position,
      isBase ? gameConfig.fx.baseExplosionMaxRadius : undefined,
      isBase ? gameConfig.fx.baseExplosionDuration : undefined,
    );
    ctx.bus.emit('entityDestroyed', {
      id: e.id,
      kind,
      owner: e.owner,
      pos: { x: e.position.x, y: e.position.y },
      // Read off the corpse while it is still in the world: `applyDamage` stamps
      // the last attacker here, and this is the only place that still has it.
      killerId: e.threat?.attackerId,
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
  for (const r of robots(world)) {
    if (r.targetId && deadIds.has(r.targetId)) r.targetId = undefined;
    if (r.threat.attackerId && deadIds.has(r.threat.attackerId)) r.threat.attackerId = undefined;
  }

  return true;
}
