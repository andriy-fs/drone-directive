import type { Vec2 } from '../../types/entities';
import { Owner } from '../../types/enums';
import { distance } from '../../utils/math';
import type { Entity } from '../ecs/entity';
import type { GameContext } from '../game/context';

/** Two owners are enemies if they differ and neither party is neutral. */
export function isEnemy(a: Owner | undefined, b: Owner | undefined): boolean {
  return a !== undefined && b !== undefined && a !== b && b !== Owner.Neutral;
}

export function findById(ctx: GameContext, id: string): Entity | undefined {
  return ctx.world.entities.find((e) => e.id === id);
}

/** Living enemy robots relative to `owner`. */
export function enemyRobots(ctx: GameContext, owner: Owner): Entity[] {
  return ctx.world.with('robot', 'position').entities.filter((e) => (e.hp ?? 0) > 0 && isEnemy(owner, e.owner));
}

/** Living enemy bases relative to `owner`. */
export function enemyBases(ctx: GameContext, owner: Owner): Entity[] {
  return ctx.world.with('base', 'position').entities.filter((e) => (e.hp ?? 0) > 0 && isEnemy(owner, e.owner));
}

/** This owner's own living base, if it still stands. */
export function ownBase(ctx: GameContext, owner: Owner): Entity | undefined {
  return ctx.world.with('base', 'position').entities.find((e) => e.owner === owner && (e.hp ?? 0) > 0);
}

/** Living enemy robots `owner`'s team currently has in sight (see `visionSystem`). */
export function knownEnemyRobots(ctx: GameContext, owner: Owner): Entity[] {
  const visible = (owner === Owner.AI ? ctx.intel.ai : ctx.intel.player).visibleRobotIds;
  return enemyRobots(ctx, owner).filter((e) => visible.has(e.id));
}

/** Living enemy bases `owner`'s team has ever discovered (see `visionSystem`). */
export function knownEnemyBases(ctx: GameContext, owner: Owner): Entity[] {
  const known = (owner === Owner.AI ? ctx.intel.ai : ctx.intel.player).knownBaseIds;
  return enemyBases(ctx, owner).filter((e) => known.has(e.id));
}

/** Nearest entity (by position) to `from`, or undefined. */
export function nearest(from: Vec2, list: Entity[]): Entity | undefined {
  let best: Entity | undefined;
  let bestDist = Infinity;
  for (const e of list) {
    if (!e.position) continue;
    const d = distance(from.x, from.y, e.position.x, e.position.y);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}
