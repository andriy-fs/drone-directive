import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { distance } from '../../utils/math';
import { spawnExplosion, spawnProjectile } from '../ecs/factory';
import type { Entity, WeaponComp } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { hasLineOfSight, isBlockedGrid, tileOf } from '../obstacles';
import { applyDisable, blockRegen, isDisabled } from './status';
import { findById, isEnemy, isTargetableDrone } from './targeting';

/**
 * Firing + projectile flight/collision. Runs after movement so shots use
 * post-movement positions. A robot fires at its current `targetId` (set by the
 * behaviour resolver) whenever it is in range, in line of sight, and off
 * cooldown — independent of movement, so it can fire while dodging or advancing.
 * Mountains block line of fire and absorb projectiles; craters do not (hence
 * `ctx.sightBlockers`, not `ctx.obstacles` — shots cross a crater that robots
 * still have to drive around). A `bomb` weapon
 * (`explosionRadius > 0`) detonates on contact instead of firing (see
 * `detonateBomb`); a `radar` weapon (range 0) never engages — it only spots; a
 * `dew` weapon fires an ordinary projectile that deals no damage and knocks the
 * robot it hits out for `freezeDuration` seconds instead (see `canEngage`).
 * Observer drones are hit only by a deliberate surface-to-air shot — see
 * `hitsAimedDrone`.
 */
export function combatSystem(ctx: GameContext, dt: number): void {
  const world = ctx.world;

  for (const e of [...world.with('robot', 'position', 'weapon')]) {
    const w = e.weapon!;
    // Knocked out: no fire, and no reloading either — the whole hull is dead
    // weight until it recovers, so the cooldown must not tick down here.
    if (isDisabled(e)) continue;
    if (w.cooldownLeft > 0) w.cooldownLeft -= dt;
    if ((e.hp ?? 0) <= 0) continue; // already caught in another bomb's blast this tick
    if (!canEngage(w) || w.cooldownLeft > 0) continue;

    const target = currentTarget(ctx, e);
    if (!target?.position) continue;
    const pos = e.position!;
    if (distance(pos.x, pos.y, target.position.x, target.position.y) > w.range) continue;
    if (!hasLineOfSight(ctx.sightBlockers, pos, target.position)) continue;

    if (w.explosionRadius > 0) {
      detonateBomb(ctx, e); // kamikaze: AOE blast + self-destruct, no projectile
      continue;
    }

    spawnProjectile(world, e.owner!, pos, target.position, target.id, w.damage, e.id, e.weaponType!);
    w.cooldownLeft = w.cooldown;
    ctx.bus.emit('projectileFired', { owner: e.owner!, pos: { x: pos.x, y: pos.y }, weapon: e.weaponType! });
  }

  stepProjectiles(ctx, dt);
}

/**
 * Whether a weapon is worth pointing at anything: it needs reach, plus *some*
 * effect on what it hits. Deliberately duck-typed off the stats rather than
 * switched on `WeaponType`, so a support weapon is defined by what it does —
 * `dew` deals no damage at all and is armed purely by `freezeDuration`, while a
 * `radar`/`ew` hull (range 0) still counts as unarmed.
 */
export function canEngage(w: WeaponComp): boolean {
  return w.range > 0 && (w.damage > 0 || w.freezeDuration > 0);
}

/**
 * The single place hp is taken off anything. Besides the subtraction it stamps
 * the two side effects every hit has, which is the reason it exists: a robot
 * remembers its attacker (so the resolver can dodge / return fire), and *any*
 * target — robot, base or drone — stops repairing itself for a while.
 *
 * Self-destruction (a bomb zeroing its own hp) deliberately does not go through
 * here: nobody attacked it, and a corpse has nothing left to lock.
 */
export function applyDamage(e: Entity, amount: number, sourceId?: string): void {
  e.hp = (e.hp ?? 0) - amount;
  if (e.robot) {
    if (!e.threat) e.threat = { underFireLeft: 0 };
    e.threat.attackerId = sourceId;
    e.threat.underFireLeft = gameConfig.behavior.underFireDuration;
  }
  blockRegen(e, gameConfig.combat.regenDelay);
}

/**
 * Kamikaze detonation: deals the bomb's `damage` to every enemy robot/base
 * whose body falls within `explosionRadius`, spawns an oversized blast visual,
 * and marks the bomb itself dead (reap removes it next, plus its death SFX).
 */
export function detonateBomb(ctx: GameContext, bomb: Entity): void {
  const world = ctx.world;
  const pos = bomb.position!;
  const { explosionRadius: r, damage } = bomb.weapon!;
  const bodyR = gameConfig.robots.radius;

  for (const robot of world.with('robot', 'position')) {
    if (robot.id === bomb.id || (robot.hp ?? 0) <= 0 || !isEnemy(bomb.owner, robot.owner)) continue;
    if (distance(pos.x, pos.y, robot.position!.x, robot.position!.y) <= r + bodyR) {
      applyDamage(robot, damage, bomb.id);
    }
  }
  for (const base of world.with('base', 'position')) {
    if ((base.hp ?? 0) <= 0 || !isEnemy(bomb.owner, base.owner)) continue;
    if (distanceToBase(pos, base) <= r) applyDamage(base, damage, bomb.id);
  }

  spawnExplosion(world, pos, r); // oversized blast; reap adds the standard death poof + SFX
  bomb.hp = 0;
}

function currentTarget(ctx: GameContext, robot: Entity): Entity | undefined {
  if (!robot.targetId) return undefined;
  const t = findById(ctx, robot.targetId);
  if (t && (t.hp ?? 0) > 0 && isEnemy(robot.owner, t.owner)) return t;
  return undefined;
}

/** Distance from point `p` to the nearest point of `base`'s footprint AABB. */
function distanceToBase(p: Vec2, base: Entity): number {
  const half = ((base.footprint ?? gameConfig.bases.footprintTiles) * gameConfig.grid.tilePx) / 2;
  const bp = base.position!;
  const cx = Math.max(bp.x - half, Math.min(p.x, bp.x + half));
  const cy = Math.max(bp.y - half, Math.min(p.y, bp.y + half));
  return distance(p.x, p.y, cx, cy);
}

function hitsBase(p: Vec2, base: Entity): boolean {
  return distanceToBase(p, base) <= gameConfig.combat.projectileRadius;
}

/**
 * Anti-air hit test: a shot damages the drone it was *aimed at*, and never one
 * that merely drifts across its path. Stray hits would be unplayable — the
 * camera keeps the drone in the middle of the fight, so it sits in every
 * crossfire by design. Deliberately fire only, and only from a `canHitAir`
 * weapon, so the rule holds even if some other code hands a cannon a drone id.
 */
function hitsAimedDrone(ctx: GameContext, p: Entity, pos: Vec2): boolean {
  if (!p.targetId || !gameConfig.robots.weapons[p.weaponType!].canHitAir) return false;

  for (const d of ctx.world.with('drone', 'position')) {
    if (d.id !== p.targetId) continue;
    if (!isEnemy(p.owner, d.owner) || !isTargetableDrone(d)) return false;
    const reach = gameConfig.drone.hitRadius + gameConfig.combat.projectileRadius;
    if (distance(pos.x, pos.y, d.position!.x, d.position!.y) > reach) return false;
    applyDamage(d, p.damage ?? 0, p.sourceId);
    return true;
  }
  return false;
}

function stepProjectiles(ctx: GameContext, dt: number): void {
  const world = ctx.world;
  const radius = gameConfig.robots.radius;
  const pr = gameConfig.combat.projectileRadius;

  for (const p of [...world.with('projectile', 'position', 'velocity')]) {
    const pos = p.position!;
    pos.x += p.velocity!.x * dt;
    pos.y += p.velocity!.y * dt;
    p.ttl = (p.ttl ?? 0) - dt;
    if (p.ttl <= 0) {
      world.remove(p);
      continue;
    }

    const cell = tileOf(pos);
    if (isBlockedGrid(ctx.sightBlockers, cell.tx, cell.ty)) {
      world.remove(p); // absorbed by a mountain (a crater is a depression — shots fly over)
      continue;
    }

    // The firing weapon's stats, not the projectile's — `weaponType` is stamped
    // on every shot precisely so its effect survives the shooter's death.
    const fired = gameConfig.robots.weapons[p.weaponType!];

    let hit = false;
    for (const r of world.with('robot', 'position')) {
      if ((r.hp ?? 0) <= 0 || !isEnemy(p.owner, r.owner)) continue;
      if (distance(pos.x, pos.y, r.position!.x, r.position!.y) <= radius + pr) {
        applyDamage(r, p.damage ?? 0, p.sourceId);
        if (fired.freezeDuration > 0) applyDisable(r, fired.freezeDuration);
        hit = true;
        break;
      }
    }
    // A harmless round (dew) flies straight over a base rather than being eaten
    // by it: buildings have no crew to knock out, so a hit there is a dud, and
    // absorbing the shot would only make the weapon feel broken.
    if (!hit && (p.damage ?? 0) > 0) {
      for (const b of world.with('base', 'position')) {
        if ((b.hp ?? 0) <= 0 || !isEnemy(p.owner, b.owner)) continue;
        if (hitsBase(pos, b)) {
          applyDamage(b, p.damage ?? 0, p.sourceId);
          hit = true;
          break;
        }
      }
    }
    if (!hit) hit = hitsAimedDrone(ctx, p, pos);
    if (hit) world.remove(p);
  }
}
