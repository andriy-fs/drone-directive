import { gameConfig, munitionReach } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { distance, vecLength } from '../../../utils/math';
import type { BaseEntity, Positioned, ProjectileEntity, Shooter } from '../../ecs/archetypes';
import { spawnEmpBurst, spawnExplosion, spawnMunition, spawnProjectile } from '../../ecs/factory';
import type { Entity, WeaponComp } from '../../ecs/entity';
import { isAlive, isBase, isPositioned } from '../../ecs/guards';
import { bases, projectiles, robots } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import type { HitTarget } from '../../game/events';
import { hasLineOfSight, isBlockedGrid, tileOf } from '../../obstacles';
import { absorbShieldDamage, isShielded } from './shield';
import { applyDisable, beginArming, blockRegen, decayArming, isArming, isDisabled } from '../../status';
import { distanceToBase, enemyAirTargets, findById, isEnemy, isKnownTo } from '../../targeting';
import { alreadyDoomed } from '../../threat';

/**
 * Firing + projectile flight/collision. Runs after movement so shots use
 * post-movement positions. A shooter fires at its current `targetId` (set by the
 * behaviour resolver) whenever it is in range, in line of sight, watched by
 * someone on its side, and off cooldown — independent of movement, so it can fire
 * while dodging or advancing.
 * Mountains block line of fire and absorb projectiles; craters do not (hence
 * `ctx.sightBlockers`, not `ctx.obstacles` — shots cross a crater that robots
 * still have to drive around). A `bomb` weapon
 * (`explosionRadius > 0`) detonates on contact instead of firing (see
 * `detonateBomb`); a `radar` weapon (range 0) never engages — it only spots; a
 * `dew` weapon fires an ordinary projectile that deals no damage and knocks the
 * robot it hits out for `freezeDuration` seconds instead (see `canEngage`); an
 * `fpv` weapon (`salvo > 0`) releases a swarm of flying munitions instead of a
 * round, over terrain and without a line of sight, and everything that happens
 * to them afterwards belongs to `systems/munition.ts`. Air is hit only by a
 * deliberate surface-to-air shot — see `hitsAimedAir`.
 *
 * **Two passes, one rule.** Bases carry a built-in battery
 * (`gameConfig.bases.weapon`) and go through the very same `fireWeapon` as a
 * robot — a second query rather than a second mechanism, because the archetype
 * tag is the only thing that differs. Everything in there stays duck-typed off
 * the weapon stats, so nothing has to know which kind of thing pulled the
 * trigger.
 */
export function combatSystem(ctx: GameContext, dt: number): void {
  for (const e of [...robots(ctx.world)]) fireWeapon(ctx, e, dt);
  for (const e of [...bases(ctx.world)]) fireWeapon(ctx, e, dt);

  stepProjectiles(ctx, dt);
}

/**
 * One shooter's turn: reload, then fire at `targetId` if it is reachable — and
 * if the side has eyes on it, which is what keeps reach beyond a hull's own
 * `sight` a reason to bring a spotter rather than a licence to shell the fog.
 *
 * `Shooter` (robot or base) rather than `Entity` is what lets the two passes
 * above share this: every field read below is on both arms of the union, which
 * is the type-level statement of "the archetype tag is the only difference".
 */
function fireWeapon(ctx: GameContext, e: Shooter, dt: number): void {
  const world = ctx.world;
  const w = e.weapon;
  // Knocked out: no fire, and no reloading either — the whole hull is dead
  // weight until it recovers, so the cooldown must not tick down here. (Always
  // false for a base: a directed-energy round has no crew to knock out.)
  if (isDisabled(e)) return;
  // Dead before its turn came round — caught in another bomb's blast this tick.
  // Checked ahead of the fuse below, so a kamikaze killed on the doorstep does not
  // still get its blast off; a corpse reloading was never observable either way.
  if (e.hp <= 0) return;
  // A lit fuse is the whole of this hull's turn: it has already committed, so
  // nothing below — target, range, line of sight — is asked again, and when the
  // fuse runs out it goes off wherever it is standing. Ticked here because
  // `combatSystem` calls this exactly once per entity per tick, and because this
  // is the one place that can act on the moment it expires.
  //
  // Sitting *below* the knock-out check is a rule, not an accident: a `dew` hit
  // stops the fuse for as long as it holds the hull, which is the only way to
  // take a started kamikaze off a target without killing it.
  if (isArming(e)) {
    if (decayArming(e, dt)) detonateBomb(ctx, e);
    return;
  }
  if (w.cooldownLeft > 0) w.cooldownLeft -= dt;
  if (!canEngage(w) || w.cooldownLeft > 0) return;

  const target = currentTarget(ctx, e);
  if (!target) return;
  const pos = e.position;
  if (distance(pos.x, pos.y, target.position.x, target.position.y) > w.range) return;
  if (needsLineOfSight(w) && !hasLineOfSight(ctx.sightBlockers, pos, target.position)) return;
  // Nothing fires at what nobody is looking at. A hull whose weapon outreaches its
  // own `sight` (`missiles`, and `fpv` by a mile) may spend the surplus only on a
  // target an ally is watching this tick; for the short weapons it is a no-op,
  // since anything inside their range is inside their own eyes. Stated here rather
  // than left to target *selection* — which already goes through the `known*`
  // helpers — because two paths bypass selection entirely: a player's explicit
  // `AttackTarget` order (bases resolve through `knownBaseIds`, a memory) and
  // manual fire from a possessed hull.
  if (!isKnownTo(ctx, e.owner, target)) return;

  if (w.explosionRadius > 0) {
    // Kamikaze: no projectile and no second thoughts. It stops here and lights its
    // fuse; the blast (AOE + self-destruct) comes `armingTime` later, in the branch
    // above. Everything that gated this tick — range, `isKnownTo`, line of sight —
    // is checked once, right here, and never revisited: the seconds it stands still
    // are the price of the payload, and letting a target walk out of range refund
    // them would hand the attacker a free look at the defence.
    beginArming(e, w.armingTime);
    ctx.bus.emit('bombArming', { owner: e.owner, id: e.id, pos: { x: pos.x, y: pos.y } });
    return;
  }

  if (w.salvo > 0) {
    // Nothing is gained by piling a second volley onto a target the drones
    // already in the air will kill. Stated here as well as in `worthShooting`,
    // which keeps *selection* off such a target, because selection happens once
    // per tick for every robot at once: ten carriers all pick the same fresh
    // target in `taskSystem` before any of them has fired. This is the pass that
    // sees the ledger fill up — `launchSalvo` puts its drones in the world
    // immediately, so the second carrier through here already counts the first
    // one's salvo. It is also what catches a player's explicit order, which
    // `worthShooting` deliberately never filters.
    if (alreadyDoomed(ctx, target)) return;
    // The one weapon whose stated `range` is not its real one. Without this it
    // would empty a salvo every nine seconds at a base its drones fall 500 px
    // short of, which is what happens on any map bigger than the small one.
    if (!withinMunitionReach(pos, target)) return;
    launchSalvo(ctx, e, target);
    w.cooldownLeft = w.cooldown;
    ctx.bus.emit('projectileFired', { owner: e.owner, pos: { x: pos.x, y: pos.y }, weapon: e.weaponType, sourceId: e.id });
    return;
  }

  spawnProjectile(world, e.owner, pos, target.position, target.id, w.damage, e.id, e.weaponType);
  w.cooldownLeft = w.cooldown;
  ctx.bus.emit('projectileFired', { owner: e.owner, pos: { x: pos.x, y: pos.y }, weapon: e.weaponType, sourceId: e.id });
}

/**
 * Whether a salvo fired from `from` could actually arrive. Measured the same way
 * the munition itself decides it has arrived (`reached` in `systems/munition.ts`)
 * — footprint edge for a base, body centre for anything else — so the launcher
 * and the drone can never disagree about whether the trip was possible.
 *
 * The launch ring is charged against the budget because a drone spawned on the
 * far side of it starts that much further out than the launcher stands.
 */
export function withinMunitionReach(from: Vec2, target: Positioned): boolean {
  const d = isBase(target)
    ? distanceToBase(from, target)
    : distance(from.x, from.y, target.position.x, target.position.y);
  return d + gameConfig.munition.launchRing <= munitionReach();
}

/**
 * Releases one launcher's whole salvo at `target`, spread evenly around the
 * launch ring so five munitions don't leave as one dot. Every drone locks
 * `target` here and never re-picks it (see `munitionSystem`), and carries the
 * launcher's id so the victim's return fire has something to aim at afterwards.
 */
export function launchSalvo(ctx: GameContext, launcher: Shooter, target: Entity): void {
  const w = launcher.weapon;
  const pos = launcher.position;
  for (let i = 0; i < w.salvo; i++) {
    const angle = (i / w.salvo) * Math.PI * 2;
    spawnMunition(ctx.world, launcher.owner, pos, angle, target.id, w.damage, launcher.id, launcher.weaponType);
  }
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
 * Whether a shot needs a clear line to its target. Everything that travels along
 * the ground does; a launcher's munitions fly over terrain, so a mountain between
 * carrier and target is not its problem. Duck-typed off `salvo` for the same
 * reason `canEngage` is duck-typed off the rest of the stats.
 */
export function needsLineOfSight(w: WeaponComp): boolean {
  return w.salvo <= 0;
}

/**
 * The single place hp is taken off anything. Besides the subtraction it stamps
 * the two side effects every hit has, which is the reason it exists: a robot
 * remembers its attacker (so the resolver can dodge / return fire), and *any*
 * target — robot, base or drone — stops repairing itself for a while.
 *
 * Self-destruction (a bomb zeroing its own hp) deliberately does not go through
 * here: nobody attacked it, and a corpse has nothing left to lock.
 *
 * Takes a plain `Entity` on purpose, where most helpers here take an archetype:
 * it is called on robots, bases, drones and munitions alike, and the callers that
 * reach it through a `findById` lookup have proved liveness (`hp > 0`) without
 * proving *shape* — which is a fact about a value, not about components, and so
 * narrows nothing. The `?? 0` below is the honest handling of that.
 */
export function applyDamage(e: Entity, amount: number, sourceId?: string): void {
  // A base's energy dome is armor, not a wall: whatever route the damage took to
  // get here — a round on the footprint, a kamikaze that drove underneath — the
  // dome eats it first. Doing it in this one place rather than in each collision
  // test is what makes that a single unconditional rule; entities with no dome
  // get their `amount` back untouched, so nothing else has to know.
  const spill = absorbShieldDamage(e, amount);
  // Swallowed whole: the building was never touched, so its passive repair must
  // not be suspended either. A dome that stopped the base mending would cost the
  // defender hp on top of their single charge.
  if (spill <= 0) return;

  e.hp = (e.hp ?? 0) - spill;
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
export function detonateBomb(ctx: GameContext, bomb: Shooter): void {
  const world = ctx.world;
  const pos = bomb.position;
  const { explosionRadius: r, damage } = bomb.weapon;
  const bodyR = gameConfig.robots.radius;

  for (const robot of robots(world)) {
    if (robot.id === bomb.id || !isAlive(robot) || !isEnemy(bomb.owner, robot.owner)) continue;
    if (distance(pos.x, pos.y, robot.position.x, robot.position.y) <= r + bodyR) {
      applyDamage(robot, damage, bomb.id);
    }
  }
  for (const base of bases(world)) {
    if (!isAlive(base) || !isEnemy(bomb.owner, base.owner)) continue;
    if (distanceToBase(pos, base) <= r) applyDamage(base, damage, bomb.id);
  }

  spawnExplosion(world, pos, r); // oversized blast; reap adds the standard death poof + SFX
  bomb.hp = 0;
}

/**
 * The shooter's live target, if it is still worth a round. Returns `Positioned`
 * rather than `Entity`: an id lookup can hand back anything, so "it is somewhere
 * on the map" is checked here once instead of being asserted by each caller.
 */
function currentTarget(ctx: GameContext, shooter: Shooter): Positioned | undefined {
  if (!shooter.targetId) return undefined;
  const t = findById(ctx, shooter.targetId);
  if (t && isPositioned(t) && isAlive(t) && isEnemy(shooter.owner, t.owner)) return t;
  return undefined;
}

/** Distance from `p` to a base's footprint *centre* — the energy dome is a circle, not the AABB. */
function distanceToBaseCentre(p: Vec2, base: BaseEntity): number {
  const bp = base.position;
  return distance(p.x, p.y, bp.x, bp.y);
}

/**
 * Whether a round dies on `base`'s energy dome instead of reaching the roof.
 *
 * Gated on what the round was *aimed at*, the same rule (and the same reason) as
 * `hitsAimedAir`: a blanket radius test would swallow every shot fired at a
 * robot standing under the dome, turning it into a bubble of cover, which is
 * exactly what it is not. Note this decides only *where the round is seen to
 * stop* — the absorption itself is `applyDamage`'s job, so a stray shot that
 * reaches the footprint still lands on the dome either way.
 */
function hitsDome(p: ProjectileEntity, pos: Vec2, base: BaseEntity): boolean {
  return (
    isShielded(base) && p.targetId === base.id && distanceToBaseCentre(pos, base) <= gameConfig.bases.shield.radius
  );
}

function hitsBase(p: Vec2, base: BaseEntity): boolean {
  return distanceToBase(p, base) <= gameConfig.combat.projectileRadius;
}

/**
 * Anti-air hit test: a shot damages the flyer it was *aimed at*, and never one
 * that merely drifts across its path. Stray hits would be unplayable — the
 * camera keeps the observer drone in the middle of the fight, so it sits in every
 * crossfire by design, and a salvo crossing a firefight would otherwise be swept
 * up by rounds meant for the ground. Deliberately fire only, and only from a
 * `canHitAir` weapon, so the rule holds even if some other code hands a cannon
 * the id of something airborne.
 */
function hitsAimedAir(ctx: GameContext, p: ProjectileEntity, pos: Vec2): boolean {
  if (!p.targetId || !gameConfig.robots.weapons[p.weaponType].canHitAir) return false;

  const flyer = enemyAirTargets(ctx, p.owner).find((e) => e.id === p.targetId);
  if (!flyer) return false;
  const bodyR = flyer.munition ? gameConfig.munition.hitRadius : gameConfig.drone.hitRadius;
  if (distance(pos.x, pos.y, flyer.position.x, flyer.position.y) > bodyR + gameConfig.combat.projectileRadius) {
    return false;
  }
  applyDamage(flyer, p.damage, p.sourceId);
  return true;
}

function stepProjectiles(ctx: GameContext, dt: number): void {
  const world = ctx.world;
  const radius = gameConfig.robots.radius;
  const pr = gameConfig.combat.projectileRadius;

  for (const projectile of [...projectiles(world)]) {
    const pos = projectile.position;
    pos.x += projectile.velocity.x * dt;
    pos.y += projectile.velocity.y * dt;
    projectile.ttl -= dt;
    if (projectile.ttl <= 0) {
      emitHit(ctx, projectile, 'expired');
      world.remove(projectile);
      continue;
    }

    const cell = tileOf(pos);
    if (isBlockedGrid(ctx.sightBlockers, cell.tx, cell.ty)) {
      emitHit(ctx, projectile, 'terrain');
      world.remove(projectile); // absorbed by a mountain (a crater is a depression — shots fly over)
      continue;
    }

    // The firing weapon's stats, not the projectile's — `weaponType` is stamped
    // on every shot precisely so its effect survives the shooter's death.
    const fired = gameConfig.robots.weapons[projectile.weaponType];

    // What this round ran into, or null while it is still flying. Doubles as the
    // old `hit` flag — the renderer needs to know *what* was struck, not just
    // that something was.
    let struck: HitTarget | null = null;
    // Where to put the discharge ring, if this round knocked something out. The
    // spawn waits until the query loop is done — adding entities mid-iteration is
    // what `detonateBomb` avoids too.
    let burstAt: Vec2 | undefined;
    for (const robot of robots(world)) {
      if (!isAlive(robot) || !isEnemy(projectile.owner, robot.owner)) continue;
      if (distance(pos.x, pos.y, robot.position.x, robot.position.y) <= radius + pr) {
        applyDamage(robot, projectile.damage, projectile.sourceId);
        if (fired.freezeDuration > 0) {
          applyDisable(robot, fired.freezeDuration);
          burstAt = { x: robot.position.x, y: robot.position.y };
        }
        struck = 'robot';
        break;
      }
    }
    // The discharge is the only moment this weapon is visibly doing anything: a
    // round that deals no damage and leaves no mark reads as a shot that missed.
    if (burstAt) spawnEmpBurst(world, burstAt);
    // A harmless round (dew) flies straight over a base rather than being eaten
    // by it: buildings have no crew to knock out, so a hit there is a dud, and
    // absorbing the shot would only make the weapon feel broken.
    if (!struck && projectile.damage > 0) {
      for (const base of bases(world)) {
        if (!isAlive(base) || !isEnemy(projectile.owner, base.owner)) continue;
        // Ahead of `hitsBase`, and while a dome stands it is the only branch a
        // round aimed at that base can take: the dome (80) reaches well past
        // the footprint (48), so the roof is simply out of reach.
        if (hitsDome(projectile, pos, base)) {
          applyDamage(base, projectile.damage, projectile.sourceId);
          struck = 'dome';
          break;
        }
        if (hitsBase(pos, base)) {
          applyDamage(base, projectile.damage, projectile.sourceId);
          struck = 'base';
          break;
        }
      }
    }
    if (!struck && hitsAimedAir(ctx, projectile, pos)) struck = 'air';
    if (struck) {
      emitHit(ctx, projectile, struck);
      world.remove(projectile);
    }
  }
}

/**
 * Announce where a round stopped and which way it was going, for whoever draws
 * the impact. Emitted from every exit in `stepProjectiles`, including the two
 * that are not collisions at all — the renderer needs to tell a shell absorbed
 * by a mountain from one that simply ran out of fuel, and neither of those may
 * look like a hit on a hull.
 *
 * The direction is normalised here rather than at the far end because this is
 * the last place the projectile exists: it is removed from the world on the very
 * next line, and the app layer observing the event has nothing left to look up.
 */
function emitHit(ctx: GameContext, projectile: ProjectileEntity, target: HitTarget): void {
  const v = projectile.velocity;
  const speed = vecLength(v.x, v.y) || 1;
  ctx.bus.emit('projectileHit', {
    owner: projectile.owner,
    pos: { x: projectile.position.x, y: projectile.position.y },
    dir: { x: v.x / speed, y: v.y / speed },
    weapon: projectile.weaponType,
    target,
  });
}
