import { gameConfig } from '../../config/gameConfig';
import type { BaseEntity, Positioned, RobotEntity } from '../../engine/ecs/archetypes';
import { isAlive } from '../../engine/ecs/guards';
import { bases, robots } from '../../engine/ecs/queries';
import type { GameContext } from '../../engine/game/context';
import { canEngage } from '../../engine/systems/combat';
import { baseFootprintContains, isEnemy, livingRobotById } from '../../engine/systems/targeting';
import { isTaskBlockedForWeapon } from '../../engine/tasks/taskDefinitions';
import type { Vec2 } from '@drone-directive/types/entities';
import { TaskType, type Owner } from '@drone-directive/types/enums';
import { distance } from '../../utils/math';

/**
 * World-space picking shared by the click that issues an order and the hover
 * highlight that previews it. They must agree: a target the cursor highlights
 * has to be the one the right click then attacks, so both go through `enemyAt`.
 */

/** `side`'s own living base under a world point, or undefined. */
export function ownBaseAt(ctx: GameContext, p: Vec2, side: Owner): BaseEntity | undefined {
  return bases(ctx.world).entities.find((e) => e.owner === side && isAlive(e) && baseFootprintContains(e, p));
}

/** The living enemy robot or base under a world point (from `side`'s perspective), or undefined. */
export function enemyAt(ctx: GameContext, p: Vec2, side: Owner): RobotEntity | BaseEntity | undefined {
  const robot = robots(ctx.world).entities.find(
    (e) =>
      isAlive(e) &&
      isEnemy(side, e.owner) &&
      distance(p.x, p.y, e.position.x, e.position.y) <= gameConfig.robots.radius + 4,
  );
  if (robot) return robot;

  return bases(ctx.world).entities.find((e) => isAlive(e) && isEnemy(side, e.owner) && baseFootprintContains(e, p));
}

/**
 * Whether any robot in `robotIds` (the local selection) could actually hurt
 * `target` — the gate on the hover highlight, so the cursor never promises an
 * attack the selection cannot carry out.
 *
 * Both rules are the engine's own rather than a second copy: `canEngage` decides
 * what counts as armed (a `dew` freezes and is armed with zero damage; a `radar`
 * with no reach is not), and `isTaskBlockedForWeapon` is what refuses a `dew`
 * pointed at a *building* — nothing there to knock out. Deliberately ignores
 * `isDisabled`: a stunned robot recovers, and the order stays valid meanwhile.
 */
export function selectionCanAttack(
  ctx: GameContext,
  robotIds: readonly string[],
  side: Owner,
  target: Positioned,
): boolean {
  const task = target.base ? TaskType.AttackBase : TaskType.AttackRobots;
  return robotIds.some((id) => {
    const e = livingRobotById(ctx, id);
    if (!e || e.owner !== side) return false;
    return canEngage(e.weapon) && !isTaskBlockedForWeapon(e.weaponType, task);
  });
}
