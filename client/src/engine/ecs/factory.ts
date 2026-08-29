import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { RobotState, TaskType, type ChassisType, type Owner, type WeaponType } from '@drone-directive/types/enums';
import { nextId } from '../../utils/id';
import { vecLength } from '../../utils/math';
import type {
  BaseEntity,
  DroneEntity,
  ExplosionEntity,
  MunitionEntity,
  ProjectileEntity,
  RobotEntity,
} from './archetypes';
import { EffectKind, type WeaponComp } from './entity';
import type { EcsWorld } from './world';

/**
 * A fresh weapon component off the config stats. Shared by robots and bases so
 * the nine fields can't drift apart between them — a new stat has to be added
 * in exactly one place.
 */
function weaponComp(weapon: WeaponType): WeaponComp {
  const w = gameConfig.robots.weapons[weapon];
  return {
    range: w.range,
    damage: w.damage,
    cooldown: w.cooldown,
    cooldownLeft: 0,
    explosionRadius: w.explosionRadius,
    jamRadius: w.jamRadius,
    canHitAir: w.canHitAir,
    freezeDuration: w.freezeDuration,
    salvo: w.salvo,
  };
}

/**
 * Adds a base entity at the given top-left tile; `position` is footprint centre.
 * Every base carries the built-in missile battery (`gameConfig.bases.weapon`):
 * `taskSystem` picks its target, `combatSystem` fires it, exactly as for a robot.
 */
export function spawnBase(world: EcsWorld, owner: Owner, tx: number, ty: number): BaseEntity {
  const { tilePx } = gameConfig.grid;
  const size = gameConfig.bases.footprintTiles;
  return world.add({
    id: nextId('base'),
    base: true,
    owner,
    position: { x: (tx + size / 2) * tilePx, y: (ty + size / 2) * tilePx },
    heading: 0,
    hp: gameConfig.bases.maxHp,
    maxHp: gameConfig.bases.maxHp,
    footprint: size,
    sightRange: gameConfig.bases.sightRange,
    weaponType: gameConfig.bases.weapon,
    weapon: weaponComp(gameConfig.bases.weapon),
    production: {
      queue: [],
      progress: 0,
      funded: false,
      autoBuild: null,
      autoBuildPreset: null,
      autoBuildStep: 0,
      defaultTask: null,
      rally: null,
    },
  });
}

/** Adds a robot entity; stats derive from chassis + weapon. */
export function spawnRobot(world: EcsWorld, owner: Owner, pos: Vec2, chassis: ChassisType, weapon: WeaponType): RobotEntity {
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
    movement: { speed: stats.speed, state: RobotState.Idle, velX: 0, velY: 0 },
    weapon: weaponComp(weapon),
    // Radar (and any future spotter) scales the chassis sight radius; others = 1.
    sightRange: stats.sight * w.sightMultiplier,
    script: { programId: TaskType.Idle, blackboard: {} },
    threat: { underFireLeft: 0 },
  });
}

/**
 * Where a side's drone is parked when it rolls out — at match start and on every
 * respawn — as a position **beside** its base plus the heading to face there.
 *
 * Not on the base. The roof's dead centre belongs to the missile battery's launcher
 * (`gameConfig.bases.weapon`), and a drone sitting on it hides the only mark that
 * says where the base's fire comes from.
 *
 * The direction is **toward the middle of the map**, which is worth stating as a
 * rule rather than a taste: bases are seated in corners with a 4-tile margin
 * (`cornerTile` in `gameConfig`), so this is the one direction that is in bounds
 * from every seat, that means the same thing for every side, and that points the eye
 * at the field it is there to watch instead of at the wall behind it.
 *
 * Deliberately obstacle-free: a drone free-flies and never pathfinds (`freeFly` in
 * `systems/drone.ts`), so there is nothing here to block against — do not add a
 * check. Pure arithmetic, so both peers of a lockstep match land on the same spot.
 */
export function droneSpawnPose(base: BaseEntity): { pos: Vec2; heading: number } {
  const dx = worldPixelSize.width / 2 - base.position.x;
  const dy = worldPixelSize.height / 2 - base.position.y;
  const len = vecLength(dx, dy);
  // A base *at* the centre has no direction to offer; park the drone below it.
  const ux = len < 1e-6 ? 0 : dx / len;
  const uy = len < 1e-6 ? 1 : dy / len;
  const d = gameConfig.drone.spawnOffset;
  return {
    pos: { x: base.position.x + ux * d, y: base.position.y + uy * d },
    heading: Math.atan2(uy, ux),
  };
}

/**
 * Adds a side's observer drone at `pos`, facing `heading`.
 *
 * Callers that are rolling one out of a base want `droneSpawnPose` for both; the
 * explicit arguments are what lets a test drop a drone anywhere it likes.
 */
export function spawnDrone(world: EcsWorld, owner: Owner, pos: Vec2, heading = 0): DroneEntity {
  return world.add({
    id: nextId('drone'),
    drone: {},
    owner,
    position: { x: pos.x, y: pos.y },
    heading,
    hp: gameConfig.drone.maxHp,
    maxHp: gameConfig.drone.maxHp,
    sightRange: gameConfig.drone.sightRange,
  });
}

/**
 * Adds one single-use FPV strike drone to a salvo. `angle` is its place in the
 * launch ring — the whole salvo leaves on the same tick, so without the spread
 * five munitions would sit on one pixel until they fan out on approach.
 *
 * `targetId` is fixed here and never re-picked: the drone that outlives its
 * target falls (see `munitionSystem`). `sourceId` is the **launcher**, not this
 * entity, so the victim's return fire has something left to shoot at once the
 * munition is gone.
 */
export function spawnMunition(
  world: EcsWorld,
  owner: Owner,
  from: Vec2,
  angle: number,
  targetId: string,
  damage: number,
  sourceId: string,
  weapon: WeaponType,
): MunitionEntity {
  const { launchRing, flightTime, hp } = gameConfig.munition;
  return world.add({
    id: nextId('fpv'),
    munition: true,
    owner,
    position: { x: from.x + Math.cos(angle) * launchRing, y: from.y + Math.sin(angle) * launchRing },
    heading: angle,
    hp,
    maxHp: hp,
    targetId,
    damage,
    sourceId,
    ttl: flightTime,
    // Which weapon released it — the renderer and the sfx adapter read this the
    // same way they read a projectile's.
    weaponType: weapon,
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
): ProjectileEntity {
  const { projectileSpeed, projectileTtl } = gameConfig.combat;
  const dx = targetPos.x - from.x;
  const dy = targetPos.y - from.y;
  const d = vecLength(dx, dy) || 1;
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

/**
 * Adds an explosion effect centred on `pos`. `maxRadius` overrides the default
 * peak size and `duration` how long it takes to get there — a base's death blast
 * is both bigger and slower than the poof a robot leaves (see `reapSystem`).
 */
export function spawnExplosion(
  world: EcsWorld,
  pos: Vec2,
  maxRadius?: number,
  // Annotated, not inferred: `gameConfig` is `as const`, so the default alone
  // would narrow this parameter to the literal 0.5 and reject every other value.
  duration: number = gameConfig.fx.explosionDuration,
): ExplosionEntity {
  return world.add({
    id: nextId('boom'),
    explosion: true,
    position: { x: pos.x, y: pos.y },
    effect: { age: 0, duration, maxRadius, kind: EffectKind.Blast },
  });
}

/**
 * Adds the discharge ring a directed-energy round leaves on the hull it hits.
 * Shares the explosion archetype (and so `explosionSystem`'s ageing and the
 * renderer's view) — only the `kind` differs, because nothing about how a
 * transient effect *lives* changes, just how it is drawn.
 */
/**
 * Adds the mark a base's energy dome leaves as it goes. Shares the explosion
 * archetype for the same reason `spawnEmpBurst` does — nothing about how a
 * transient effect *lives* changes, only how it is drawn.
 *
 * `shattered` is the whole point of the function: beaten down under fire and run
 * out of time are the two endings the player must never confuse, so they get
 * different kinds and different durations rather than one effect with a flag the
 * renderer might ignore.
 */
export function spawnShieldEnd(world: EcsWorld, pos: Vec2, shattered: boolean): ExplosionEntity {
  const { shieldBreakDuration, shieldExpireDuration } = gameConfig.fx;
  return world.add({
    id: nextId('boom'),
    explosion: true,
    position: { x: pos.x, y: pos.y },
    effect: {
      age: 0,
      duration: shattered ? shieldBreakDuration : shieldExpireDuration,
      maxRadius: gameConfig.bases.shield.radius,
      kind: shattered ? EffectKind.ShieldBreak : EffectKind.ShieldExpire,
    },
  });
}

export function spawnEmpBurst(world: EcsWorld, pos: Vec2): ExplosionEntity {
  return world.add({
    id: nextId('boom'),
    explosion: true,
    position: { x: pos.x, y: pos.y },
    effect: {
      age: 0,
      duration: gameConfig.fx.empBurstDuration,
      maxRadius: gameConfig.fx.empBurstMaxRadius,
      kind: EffectKind.Emp,
    },
  });
}
