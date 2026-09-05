import { gameConfig } from '../../config/gameConfig';
import { OverrideKind } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';
import type { RobotEntity } from '../ecs/archetypes';
import { spawnEmpBurst } from '../ecs/factory';
import { isAlive } from '../ecs/guards';
import { munitions, robots } from '../ecs/queries';
import type { GameContext } from '../game/context';
import { applyDisable, beginOverride, decayOverride, isOverrideRunning } from '../status';
import { isEnemy, possessedRobotOf } from '../targeting';
import { detonateBomb } from './combat';

/**
 * The hull's service menu — the experimental modes a pilot can reach from inside
 * a machine the drone is riding, and which exist nowhere else in the interface.
 *
 * **The rule the whole feature hangs on: every mode ends with the hull
 * destroyed.** What differs between them is only how long the machine lives
 * afterwards and what that time buys. That single rule is doing a lot of work —
 * it is why nothing here counts charges or cooldowns (the machine is the cost),
 * why arming one is a decision rather than a reflex, and why all of them are
 * explained to the player by one fiction: the battery overheats once the
 * limiters come off.
 *
 * ## Why the immunity is not the base's dome
 *
 * `Shield` here and `systems/combat/shield.ts` sound like the same thing and are
 * opposites. The dome is **armor**: a finite pool that absorbs, spills its
 * overkill through, and can be broken by concentrating fire. This is
 * **immunity**: absolute, unbreakable, and bounded only by a clock. Nothing can
 * shoot it down, and nothing needs to — it takes the machine with it either way.
 * Reusing the dome's component would also have been a quiet bug, since `shield`
 * is an archetype tag for `shieldedBases`: a robot wearing one would neither
 * tick nor draw.
 *
 * ## The eligibility gate lives here, on both peers
 *
 * `net/` checks only that the value on the wire names a mode. Everything else —
 * right side, right hull, right weapon, nothing already running — is recomputed
 * from the world by `startOverride`, identically on every peer. A gate applied
 * only by the sender is not a gate: a doctored client would otherwise raise a
 * shield on a machine it is not flying.
 *
 * ## What lives here and what lives in `status.ts`
 *
 * The timer and its accessors (`isOverrideRunning`, `overrideKind`,
 * `absorbsAllDamage`, `beginOverride`, `decayOverride`) are in `status.ts`
 * beside the other three effects; this file holds the policy — who may arm one,
 * what the pulse does, and how the hull ends. Same split the kamikaze fuse
 * already has with `combat`, and it is what keeps `applyDamage` from importing a
 * system that imports `applyDamage`.
 */

/**
 * Seconds a mode runs before it takes the hull with it. Exported because the
 * instruments draw the countdown as a fraction and must divide by the same
 * number this file counted down from.
 */
export function overrideDuration(kind: OverrideKind): number {
  const { shield, overload } = gameConfig.drone.overrides;
  return kind === OverrideKind.Shield ? shield.duration : overload.charge;
}

/**
 * Whether this hull's electronics can be dumped into a pulse at all.
 *
 * Duck-typed off the weapon rather than compared against `WeaponType`, matching
 * every other damage-and-effect path in the engine: what makes a machine capable
 * of an EMP is that it already carries the hardware for one — a jamming bubble
 * or a directed-energy emitter. A weapon added later with either field gets the
 * mode without this file being edited.
 */
function canOverload(robot: RobotEntity): boolean {
  const w = robot.weapon;
  return w.jamRadius > 0 || w.freezeDuration > 0;
}

/**
 * Which modes this hull could run — **pure**, so the HUD can offer exactly what
 * the engine would accept. Split from `startOverride` the way `canRaiseShield`
 * is split from `raiseShield`, and for the same reason: a menu that lit up a row
 * the simulation then refused would read as the game having ignored the player.
 *
 * Deliberately says nothing about *this moment* — whether a mode is already
 * running, or who is flying the hull. Those belong to `startOverride`, which the
 * snapshot reports separately as `running`.
 */
export function availableOverrides(robot: RobotEntity): OverrideKind[] {
  const list: OverrideKind[] = [OverrideKind.Shield];
  if (canOverload(robot)) list.push(OverrideKind.Overload);
  return list;
}

/**
 * Arms `kind` on `robot`. The only place the component is attached.
 *
 * Returns whether anything happened, so a refusal can stay silent — the same
 * contract `raiseShield` has. A pilot who asks for something impossible has
 * simply not spent their machine.
 */
export function startOverride(ctx: GameContext, robot: RobotEntity, kind: OverrideKind): boolean {
  if (kind === OverrideKind.None) return false;
  if (!isAlive(robot) || isOverrideRunning(robot)) return false;
  if (!availableOverrides(robot).includes(kind)) return false;
  // The hull must be the one this side's drone is actually riding. Checked from
  // the world rather than trusted from the frame: this is the line that stops a
  // doctored client arming a mode on a machine it is not flying.
  if (possessedRobotOf(ctx, robot.owner)?.id !== robot.id) return false;

  beginOverride(robot, kind, overrideDuration(kind));
  ctx.bus.emit('overrideArmed', {
    owner: robot.owner,
    id: robot.id,
    kind,
    pos: { x: robot.position.x, y: robot.position.y },
  });
  return true;
}

/**
 * One step of every running mode: decrement once, and on the tick it runs out do
 * whatever the mode does on its way out, then destroy the hull.
 *
 * Runs between `munitionSystem` and `shieldSystem` — after combat, so a mode
 * covers the hits that landed on the tick it was still up; before `reapSystem`,
 * so a hull finished off by its own blast leaves in the same tick it went.
 */
export function overrideSystem(ctx: GameContext, dt: number): void {
  // Copy: `endHull` can kill neighbours through `detonateBomb`, and a query is a
  // live view of the world.
  for (const robot of [...robots(ctx.world)]) {
    if (!robot.override) continue;

    // Killed before the clock ran out — by anti-air, by a neighbour's blast, by
    // anything at all. The mode dies with the machine and never fires: that is
    // precisely the answer a defender has to a charging `Overload`, and the
    // reason those two seconds are the number worth tuning. Left on the corpse
    // for `reap` to take away with the entity.
    if (!isAlive(robot)) continue;

    const spent = decayOverride(robot, dt); // exactly once per tick — the `status.ts` invariant
    if (!spent) continue;

    if (spent === OverrideKind.Overload) fireEmp(ctx, robot);
    endHull(ctx, robot);
  }
}

/**
 * The pulse: everything hostile within `radius` is knocked out for
 * `disableSeconds`, and any enemy strike drone caught in it comes down.
 *
 * Scoped to robots and munitions, exactly like the `dew` shot and the `ew`
 * bubble it is built out of — a base has no controls to lose, and disabling one
 * would be a different weapon wearing this one's name.
 */
function fireEmp(ctx: GameContext, hull: RobotEntity): void {
  const { radius, disableSeconds } = gameConfig.drone.overrides.overload;
  const pos = hull.position;

  for (const foe of robots(ctx.world)) {
    if (!isEnemy(hull.owner, foe.owner) || !isAlive(foe)) continue;
    if (distance(pos.x, pos.y, foe.position.x, foe.position.y) <= radius) {
      applyDisable(foe, disableSeconds);
    }
  }

  // Dropped by zeroing hp rather than by removing the entity: `munitionSystem`
  // owns a strike drone from launch to landing and nothing else may take one out
  // of the world. Its first death check is exactly this, so the airframe falls on
  // the next tick — the same route anti-air already uses.
  for (const m of munitions(ctx.world)) {
    if (!isEnemy(hull.owner, m.owner) || m.hp <= 0) continue;
    if (distance(pos.x, pos.y, m.position.x, m.position.y) <= radius) m.hp = 0;
  }

  spawnEmpBurst(ctx.world, pos);
  ctx.bus.emit('overrideFired', {
    owner: hull.owner,
    id: hull.id,
    kind: OverrideKind.Overload,
    pos: { x: pos.x, y: pos.y },
  });
}

/**
 * Spends the machine. A kamikaze goes off as a kamikaze — the blast it was built
 * for, aimed at wherever the pilot drove it; anything else simply stops.
 *
 * `hp = 0` **directly, never through `applyDamage`**: a hull under `Shield` is
 * immune to that path, so routing its own death through it would leave the mode
 * unable to end and the immunity permanent. Self-destruction is not damage —
 * `detonateBomb` has always taken the same shortcut for the same reason — and
 * `reapSystem` draws the death from here exactly as it does any other.
 */
function endHull(ctx: GameContext, robot: RobotEntity): void {
  if (robot.weapon.explosionRadius > 0) {
    detonateBomb(ctx, robot);
    return;
  }
  robot.hp = 0;
}
