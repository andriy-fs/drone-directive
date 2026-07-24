import { gameConfig } from '../../config/gameConfig';
import type { Vec2 } from '../../types/entities';
import { distance } from '../../utils/math';
import { spawnExplosion, spawnProjectile } from '../ecs/factory';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { hasLineOfSight, isBlockedGrid, tileOf } from '../obstacles';
import { findById, isEnemy } from './targeting';

/**
 * Firing + projectile flight/collision. Runs after movement so shots use
 * post-movement positions. A robot fires at its current `targetId` (set by the
 * behaviour resolver) whenever it is in range, in line of sight, and off
 * cooldown — independent of movement, so it can fire while dodging or advancing.
 * Obstacles block line of fire and absorb projectiles. A `bomb` weapon
 * (`explosionRadius > 0`) detonates on contact instead of firing (see
 * `detonateBomb`); a `radar` weapon (range 0) never engages — it only spots.
 */
export function combatSystem(ctx: GameContext, dt: number): void {
  const world = ctx.world;

  for (const e of [...world.with('robot', 'position', 'weapon')]) {
    const w = e.weapon!;
    if (w.cooldownLeft > 0) w.cooldownLeft -= dt;
    if ((e.hp ?? 0) <= 0) continue; // already caught in another bomb's blast this tick
    if (w.range <= 0 || w.damage <= 0 || w.cooldownLeft > 0) continue;

    const target = currentTarget(ctx, e);
    if (!target?.position) continue;
    const pos = e.position!;
    if (distance(pos.x, pos.y, target.position.x, target.position.y) > w.range) continue;
    if (!hasLineOfSight(ctx.obstacles, pos, target.position)) continue;

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
      robot.hp = (robot.hp ?? 0) - damage;
      if (!robot.threat) robot.threat = { underFireLeft: 0 };
      robot.threat.attackerId = bomb.id;
      robot.threat.underFireLeft = gameConfig.behavior.underFireDuration;
    }
  }
  for (const base of world.with('base', 'position')) {
    if ((base.hp ?? 0) <= 0 || !isEnemy(bomb.owner, base.owner)) continue;
    if (distanceToBase(pos, base) <= r) base.hp = (base.hp ?? 0) - damage;
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
    if (isBlockedGrid(ctx.obstacles, cell.tx, cell.ty)) {
      world.remove(p); // absorbed by terrain
      continue;
    }

    let hit = false;
    for (const r of world.with('robot', 'position')) {
      if ((r.hp ?? 0) <= 0 || !isEnemy(p.owner, r.owner)) continue;
      if (distance(pos.x, pos.y, r.position!.x, r.position!.y) <= radius + pr) {
        r.hp = (r.hp ?? 0) - (p.damage ?? 0);
        // Remember the attacker so the resolver can dodge / return fire.
        if (!r.threat) r.threat = { underFireLeft: 0 };
        r.threat.attackerId = p.sourceId;
        r.threat.underFireLeft = gameConfig.behavior.underFireDuration;
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const b of world.with('base', 'position')) {
        if ((b.hp ?? 0) <= 0 || !isEnemy(p.owner, b.owner)) continue;
        if (hitsBase(pos, b)) {
          b.hp = (b.hp ?? 0) - (p.damage ?? 0);
          hit = true;
          break;
        }
      }
    }
    if (hit) world.remove(p);
  }
}
