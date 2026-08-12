import { gameConfig, worldPixelSize } from '../../config/gameConfig';
import { clamp, distance, vecLength } from '../../utils/math';
import { spawnExplosion } from '../ecs/factory';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';
import { applyDamage } from './combat';
import { isDisabled } from './status';
import { distanceToBase, findById, isEnemy } from './targeting';

/**
 * Flight, interception and impact of single-use FPV strike drones — everything a
 * munition does between leaving its carrier (`launchSalvo`, `systems/combat.ts`)
 * and ceasing to exist. Nothing else in the engine knows they are alive.
 *
 * **Runs immediately after `combatSystem`, before `shieldSystem`.** After combat,
 * so anti-air fire that connected this tick removes the drone on the same tick it
 * was hit rather than letting a corpse land its damage; before shield, so a hit on
 * a base reaches the dome in the same tick's accounting as an ordinary round.
 *
 * A munition never reaches `reapSystem`: it is not a robot, base or drone, has no
 * `entityDestroyed` event, no death sound and no dangling references to clean up
 * (its `targetId` points *out*, and nothing points *at* it — a shooter that aimed
 * at one simply finds nothing next tick). So its whole life ends here, in one of
 * the five ways below.
 *
 * The one thing that makes this cheap enough to run five-per-carrier: a munition
 * is deliberately stupid. It never re-picks a target, never pathfinds, never
 * dodges, and holds no state beyond the fields it was born with.
 */
export function munitionSystem(ctx: GameContext, dt: number): void {
  for (const m of [...ctx.world.with('munition', 'position')]) stepMunition(ctx, dt, m);
}

/**
 * One drone's tick. Order matters and is fixed by tests: shot down, jammed and
 * timed out are all checked *before* the step, so a drone that should be gone
 * can never cover its last few pixels and land a hit on the way out.
 */
function stepMunition(ctx: GameContext, dt: number, m: Entity): void {
  // 1. Shot down by anti-air this tick (`hitsAimedAir` already took the hp off).
  if ((m.hp ?? 0) <= 0) return fall(ctx, m);

  // 2. Flown into an enemy jamming bubble. The link is what an FPV drone *is*,
  // so `ew` doesn't damage it — it takes the pilot away and the airframe drops.
  // This is the hard counter to a salvo, next to anti-air's soft one.
  if (isJammed(ctx, m)) return fall(ctx, m);

  // 3. Out of flight time — the drone that found nothing simply comes down.
  m.ttl = (m.ttl ?? 0) - dt;
  if (m.ttl <= 0) return fall(ctx, m);

  // 4. Target gone. Locked at launch and never re-picked: a swarm that re-targeted
  // would make pulling a damaged unit out of the line pointless, which is one of
  // the few answers there is to this weapon.
  const target = m.targetId ? findById(ctx, m.targetId) : undefined;
  if (!target?.position || (target.hp ?? 0) <= 0 || !isEnemy(m.owner, target.owner)) return fall(ctx, m);

  // 5. Fly at it, free of terrain, and detonate on contact.
  const pos = m.position!;
  const tp = target.position;
  const dx = tp.x - pos.x;
  const dy = tp.y - pos.y;
  const len = vecLength(dx, dy) || 1;
  const step = gameConfig.munition.speed * dt;
  pos.x = clamp(pos.x + (dx / len) * step, 0, worldPixelSize.width);
  pos.y = clamp(pos.y + (dy / len) * step, 0, worldPixelSize.height);
  m.heading = Math.atan2(dy, dx);

  if (reached(m, target)) {
    // `sourceId` is the launcher, not this drone: the victim's return fire has to
    // find something that still exists a tick from now.
    applyDamage(target, m.damage ?? 0, m.sourceId);
    fall(ctx, m);
  }
}

/** Whether `m` is touching its target's body (robots are circles, bases are footprints). */
function reached(m: Entity, target: Entity): boolean {
  const pos = m.position!;
  const r = gameConfig.munition.hitRadius;
  if (target.base) return distanceToBase(pos, target) <= r;
  return distance(pos.x, pos.y, target.position!.x, target.position!.y) <= r + gameConfig.robots.radius;
}

/**
 * Whether an enemy jammer's bubble currently covers `m`. Mirrors `visionSystem`'s
 * rule for who counts as a jammer at all — alive, armed with a `jamRadius`, and
 * not knocked out — so a `dew` hit takes an `ew` robot's air defence down with
 * the rest of its electronics, exactly as it takes its jamming of sight.
 */
function isJammed(ctx: GameContext, m: Entity): boolean {
  const pos = m.position!;
  return ctx.world
    .with('robot', 'position', 'weapon')
    .entities.some(
      (j) =>
        isEnemy(m.owner, j.owner) &&
        (j.hp ?? 0) > 0 &&
        j.weapon!.jamRadius > 0 &&
        !isDisabled(j) &&
        distance(pos.x, pos.y, j.position!.x, j.position!.y) <= j.weapon!.jamRadius,
    );
}

/**
 * The one exit. Leaves a small puff so a drone that dies short of its target is
 * visibly *stopped* rather than silently missing — but no `entityDestroyed` event
 * and so no death sound: five of these end within a second or two of each other,
 * and five death reports per salvo would drown the fight they belong to.
 */
function fall(ctx: GameContext, m: Entity): void {
  spawnExplosion(ctx.world, m.position!, gameConfig.munition.hitRadius);
  ctx.world.remove(m);
}
