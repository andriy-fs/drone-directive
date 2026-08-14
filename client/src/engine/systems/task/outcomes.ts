import { gameConfig, worldPixelSize } from '../../../config/gameConfig';
import { TaskType } from '@drone-directive/types/enums';
import { clamp, distance, vecLength } from '../../../utils/math';
import type { Positioned, RobotEntity } from '../../ecs/archetypes';
import { isAlive, isPositioned } from '../../ecs/guards';
import { robots } from '../../ecs/queries';
import type { GameContext } from '../../game/context';
import { hasLineOfSight } from '../../obstacles';
import { needsLineOfSight } from '../combat';
import { isDisabled } from '../status';
import {
  findById,
  isEnemy,
  isKnownTo,
  knownEnemyBases,
  knownEnemyRobots,
  nearest,
  ownBase,
  worthShooting,
} from '../targeting';
import { isAdvancing } from './advancing';
import { centroidOf, randomPointNear, roamOutcome, searchOutcome } from './roam';
import type { Outcome } from './types';

/**
 * Base perimeter defence. The difference from `guard` is the whole point of the
 * program: the intercept test is "is an enemy near **my base**", not "is an
 * enemy in **my** weapon range", and the answer is to *move* onto it. So a
 * single attacker poking the perimeter is met by everyone posted there rather
 * than trading free shots against whoever it picked — and once it is gone the
 * defenders go back to the base instead of chasing it across the map.
 */
export function defendBaseOutcome(ctx: GameContext, e: RobotEntity, range?: number): Outcome {
  const home = ownBase(ctx, e.owner);
  if (!home) return {}; // no base left to defend — let a lower-priority directive decide
  const post = home.position;

  // Nothing to intercept *with*: a radar or an EW jammer that drove at an
  // intruder would only die at it. It still patrols, which is what its sight
  // aura is for — early warning for the units that can shoot.
  if (e.weapon.range > 0) {
    const reach = range ?? gameConfig.behavior.defendBaseRadius;
    const foe = nearest(
      post,
      knownEnemyRobots(ctx, e.owner).filter(
        (r) => distance(post.x, post.y, r.position.x, r.position.y) <= reach && worthShooting(ctx, e, r),
      ),
    );
    if (foe) return engageOutcome(ctx, e, foe);
  }

  return roamOutcome(e, () => randomPointNear(ctx, post, gameConfig.behavior.defendPatrolRadius));
}

/**
 * Attack in a body. A unit on this directive holds the base line until enough
 * allies on the same directive have gathered around the base, at which point the
 * *whole* group latches `committed` and advances together.
 *
 * Two details carry the behaviour:
 *
 * - **Only units that haven't left yet are counted.** Counting the wave already
 *   out on the map would keep the threshold permanently satisfied, and every new
 *   robot would trickle out alone — exactly what attacking in groups is meant to
 *   avoid.
 * - **The group commits in one pass, not one robot at a time.** The pool of
 *   waiting units shrinks as it commits, so committing individually would leave
 *   the tail below the threshold — stuck at base forever, waiting for a group
 *   that can no longer form.
 */
export function groupAttackOutcome(ctx: GameContext, e: RobotEntity, size?: number): Outcome {
  const bb = e.script.blackboard;

  if (!bb.committed) {
    const home = ownBase(ctx, e.owner);
    // No base to gather at: there is nothing left to defend and nothing to wait
    // for, so the group requirement is moot — go.
    if (!home) bb.committed = true;
    else {
      const radius = gameConfig.behavior.groupGatherRadius;
      const hp = home.position;
      const mates = robots(ctx.world).entities.filter(
        (r) =>
          r.owner === e.owner &&
          isAlive(r) &&
          !isDisabled(r) &&
          r.script.programId === TaskType.GroupAttack &&
          !r.script.blackboard.committed &&
          distance(hp.x, hp.y, r.position.x, r.position.y) <= radius,
      );
      if (mates.length >= (size ?? gameConfig.behavior.groupAttackSize)) {
        for (const mate of mates) mate.script.blackboard.committed = true;
      }
    }
  }

  // Still gathering — hold the base line rather than stand around as a free kill.
  if (!bb.committed) return defendBaseOutcome(ctx, e);

  const base = nearest(
    e.position,
    knownEnemyBases(ctx, e.owner).filter((b) => worthShooting(ctx, e, b)),
  );
  if (base) return engageOutcome(ctx, e, base);
  const foe = nearest(
    e.position,
    knownEnemyRobots(ctx, e.owner).filter((r) => worthShooting(ctx, e, r)),
  );
  if (foe) return engageOutcome(ctx, e, foe);
  return searchOutcome(ctx, e); // nothing known yet — go find it
}

/** Focus-fire the specific ordered target (robot or base); hold once it's gone. */
export function attackTargetOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  const id = e.script.blackboard.attackTargetId;
  const target = id ? findById(ctx, id) : undefined;
  if (!target || !isPositioned(target) || !isAlive(target) || !isEnemy(e.owner, target.owner)) {
    return { move: { kind: 'hold' } }; // target destroyed/invalid — stop and defend
  }
  return engageOutcome(ctx, e, target);
}

/**
 * Approach a target, stopping to fire once in weapon range, with line of sight,
 * and **watched by someone on this side**.
 *
 * That last condition is not decoration: `fireWeapon` refuses to shoot at what
 * nobody can see, so a hull that stopped merely because the target was in range
 * would stand there in silence forever. It is reachable in practice because a
 * weapon may outreach its own hull's sight (`missiles`, 255 against 230) and
 * because a base stays *known* long after it stops being *seen* — an ordered
 * attack on a base discovered earlier in the match is exactly the case that
 * deadlocked. Unseen therefore means "not in position yet": keep closing until
 * either this hull or an ally has eyes on it.
 *
 * A launcher (`salvo > 0`) needs no line of sight — its munitions fly over
 * terrain — and its reach spans the map, so in the ordinary case (a target its
 * side is already watching) it still holds wherever it stands and fires, which is
 * the intended shape of the unit: artillery, not a brawler. See `weapons.fpv` in
 * `gameConfig`. A carrier sent at a base nobody is watching does now roll forward
 * until it can see it, because the alternative is a unit that stands still and
 * never shoots.
 */
export function engageOutcome(ctx: GameContext, e: RobotEntity, target: Positioned): Outcome {
  const pos = e.position;
  const tp = target.position;
  const w = e.weapon;
  const range = w.range;
  const d = distance(pos.x, pos.y, tp.x, tp.y);

  if (range <= 0) {
    // Unarmed: close to a stand-off distance so it doesn't jam the target.
    if (d > gameConfig.combat.unarmedStandoff) return { move: { kind: 'goal', x: tp.x, y: tp.y } };
    return { move: { kind: 'hold' } };
  }
  const clear = !needsLineOfSight(w) || hasLineOfSight(ctx.sightBlockers, pos, tp);
  if (d <= range && clear && isKnownTo(ctx, e.owner, target)) {
    return { move: { kind: 'hold' }, fire: target.id };
  }
  return { move: { kind: 'goal', x: tp.x, y: tp.y }, fire: target.id };
}

/** Fire-only: shoot back at the last attacker if it's still a valid target. */
export function attackAttackerOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  const id = e.threat.attackerId;
  if (!id) return {};
  const attacker = findById(ctx, id);
  if (!attacker || !isPositioned(attacker) || !isAlive(attacker)) return {};
  if (!worthShooting(ctx, e, attacker)) return {};
  return { fire: attacker.id };
}

/**
 * Move-only: strafe perpendicular to incoming fire to dodge. A kamikaze has
 * nothing to gain from surviving — dodging only pushes it out of its own
 * (short) blast range of whoever's attacking it, so it never runs: it just
 * holds (falling through to `attackNearestRobot`/`attackAttacker` below to
 * close in and detonate on the group instead of fleeing a fight it can't lose).
 */
export function evadeOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  if (e.weapon.explosionRadius > 0) return {};

  const pos = e.position;
  const attackerId = e.threat.attackerId;
  const attacker = attackerId ? findById(ctx, attackerId) : undefined;
  const from =
    attacker && isPositioned(attacker) && isAlive(attacker)
      ? attacker.position
      : nearest(pos, knownEnemyRobots(ctx, e.owner))?.position;
  if (!from) return {}; // nothing to dodge — let a lower-priority directive move us

  const dx = pos.x - from.x;
  const dy = pos.y - from.y;
  const len = vecLength(dx, dy) || 1;
  // Perpendicular to the line of fire; side chosen deterministically per robot.
  let px = -dy / len;
  let py = dx / len;
  if (evadeSide(e.id) < 0) {
    px = -px;
    py = -py;
  }
  const dist = gameConfig.behavior.evadeDistance;
  return {
    move: {
      kind: 'goal',
      x: clamp(pos.x + px * dist, 0, worldPixelSize.width),
      y: clamp(pos.y + py * dist, 0, worldPixelSize.height),
    },
  };
}

/**
 * Perimeter defence: patrol a random point within `guardPatrolRadius` of the
 * guard post (like `search`, but bounded near base) rather than standing
 * still, engaging anything that comes within weapon range along the way.
 */
export function guardOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  const pos = e.position;
  const range = e.weapon.range;
  const post = e.script.blackboard.guardPos;

  if (range > 0) {
    const foe = nearest(
      pos,
      knownEnemyRobots(ctx, e.owner).filter((r) => worthShooting(ctx, e, r)),
    );
    if (foe && distance(pos.x, pos.y, foe.position.x, foe.position.y) <= range) {
      // Same line-of-sight exemption as `engageOutcome`, and it matters more
      // here: a launcher's reach spans the map, so there is nearly always a
      // mountain somewhere on the straight line, and requiring a clear one would
      // leave a guarding carrier silently never firing.
      if (!needsLineOfSight(e.weapon) || hasLineOfSight(ctx.sightBlockers, pos, foe.position)) {
        return { move: { kind: 'hold' }, fire: foe.id };
      }
    }
  }
  if (!post) return { move: { kind: 'hold' } };
  return roamOutcome(e, () => randomPointNear(ctx, post, gameConfig.behavior.guardPatrolRadius));
}

/** Move-only: fall back toward this side's own base — for a unit with nothing to fight back with. */
export function retreatToBaseOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  const home = ownBase(ctx, e.owner);
  if (!home) return {}; // no base left to run to — let a lower-priority directive decide
  return { move: { kind: 'goal', x: home.position.x, y: home.position.y } };
}

/**
 * Unarmed support role: trail behind an advancing friendly group (own team's
 * robots currently running an attack-oriented program), staying
 * `overwatchTrailDistance` back toward home — close enough to keep spotting
 * for it without leading the charge. With no such push under way, it instead
 * hovers near its own base, roaming like a Guard for early-warning coverage.
 */
export function overwatchOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  const home = ownBase(ctx, e.owner);
  if (!home) return { move: { kind: 'hold' } };
  const hp = home.position;

  const vanguard = robots(ctx.world).entities.filter(
    (r) => r.id !== e.id && r.owner === e.owner && isAlive(r) && isAdvancing(r),
  );

  if (vanguard.length > 0) {
    const centroid = centroidOf(vanguard);
    const dx = hp.x - centroid.x;
    const dy = hp.y - centroid.y;
    const len = vecLength(dx, dy) || 1;
    const trail = gameConfig.behavior.overwatchTrailDistance;
    return {
      move: {
        kind: 'goal',
        x: centroid.x + (dx / len) * trail,
        y: centroid.y + (dy / len) * trail,
      },
    };
  }

  return roamOutcome(e, () => randomPointNear(ctx, hp, gameConfig.behavior.guardPatrolRadius));
}

/** Stable per-robot dodge side so a robot doesn't jitter between the two. */
function evadeSide(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}
