import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { RobotState, TaskType, type ChassisType, type Owner, type WeaponType } from '../../types/enums';
import { nextId } from '../../utils/id';
import type { Entity } from './entity';
import type { EcsWorld } from './world';

/** Adds a base entity at the given top-left tile; `position` is footprint centre. */
export function spawnBase(world: EcsWorld, owner: Owner, tx: number, ty: number): Entity {
  const { tilePx } = gameConfig.grid;
  const size = gameConfig.bases.footprintTiles;
  return world.add({
    id: nextId('base'),
    base: true,
    owner,
    position: { x: (tx + size / 2) * tilePx, y: (ty + size / 2) * tilePx },
    hp: gameConfig.bases.maxHp,
    maxHp: gameConfig.bases.maxHp,
    footprint: size,
    sightRange: gameConfig.bases.sightRange,
    production: { queue: [], progress: 0, autoBuild: null, autoBuildPreset: null, autoBuildStep: 0, defaultTask: null },
  });
}

/** Adds a robot entity; stats derive from chassis + weapon. */
export function spawnRobot(world: EcsWorld, owner: Owner, pos: Vec2, chassis: ChassisType, weapon: WeaponType): Entity {
  const stats = gameConfig.robots.chassis[chassis];
  const w = gameConfig.robots.weapons[weapon];
  return world.add({
    id: nextId('robot'),
    robot: true,
    owner,
    position: { x: pos.x, y: pos.y },
    heading: 0,
    hp: stats.hp,
    maxHp: stats.hp,
    chassis,
    weaponType: weapon,
    movement: { speed: stats.speed, state: RobotState.Idle },
    weapon: {
      range: w.range,
      damage: w.damage,
      cooldown: w.cooldown,
      cooldownLeft: 0,
      explosionRadius: w.explosionRadius,
      jamRadius: w.jamRadius,
    },
    // Radar (and any future spotter) scales the chassis sight radius; others = 1.
    sightRange: stats.sight * w.sightMultiplier,
    script: { programId: TaskType.Idle, blackboard: {} },
    threat: { underFireLeft: 0 },
  });
}

/** Adds the player's observer drone at `pos` (the base "roof" at match start). */
export function spawnDrone(world: EcsWorld, owner: Owner, pos: Vec2): Entity {
  return world.add({
    id: nextId('drone'),
    drone: {},
    owner,
    position: { x: pos.x, y: pos.y },
    heading: 0,
    sightRange: gameConfig.drone.sightRange,
  });
}

/** Adds a projectile travelling from `from` toward `targetPos`. */
export function spawnProjectile(
  world: EcsWorld,
  owner: Owner,
  from: Vec2,
  targetPos: Vec2,
  targetId: string | undefined,
  damage: number,
  sourceId: string,
  weapon: WeaponType,
): Entity {
  const { projectileSpeed, projectileTtl } = gameConfig.combat;
  const dx = targetPos.x - from.x;
  const dy = targetPos.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  return world.add({
    id: nextId('proj'),
    projectile: true,
    owner,
    position: { x: from.x, y: from.y },
    velocity: { x: (dx / d) * projectileSpeed, y: (dy / d) * projectileSpeed },
    damage,
    targetId,
    sourceId,
    ttl: projectileTtl,
    // Which weapon fired this shot (render + sfx pick their look/sound from it).
    weaponType: weapon,
  });
}

/** Adds an explosion effect centred on `pos`; `maxRadius` overrides the default peak size. */
export function spawnExplosion(world: EcsWorld, pos: Vec2, maxRadius?: number): Entity {
  return world.add({
    id: nextId('boom'),
    explosion: true,
    position: { x: pos.x, y: pos.y },
    effect: { age: 0, duration: gameConfig.fx.explosionDuration, maxRadius },
  });
}
