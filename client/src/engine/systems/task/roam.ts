import { gameConfig } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { distance } from '../../../utils/math';
import type { Positioned, RobotEntity } from '../../ecs/archetypes';
import type { GameContext } from '../../game/context';
import { isBlockedGrid, tileCentre, tileOf } from '../../obstacles';
import { nearestFreeTile, type Tile } from '../../pathfinding';
import type { Outcome } from './types';

/** Orthogonal steps for the patrol-ring flood fill — 4-directional, so it can't claim a tile A* would refuse to corner-cut into. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Move-only: roam toward a random spot, picking a new one on arrival. */
export function searchOutcome(ctx: GameContext, e: RobotEntity): Outcome {
  return roamOutcome(e, () => randomSearchPoint(ctx));
}

/** Shared roam loop: walk to `blackboard.roamTarget`, picking a fresh one (via `pickPoint`) on arrival. */
export function roamOutcome(e: RobotEntity, pickPoint: () => Vec2): Outcome {
  const pos = e.position;
  const bb = e.script.blackboard;
  let goal = bb.roamTarget;
  if (!goal || distance(pos.x, pos.y, goal.x, goal.y) <= gameConfig.robots.arrivalThreshold) {
    goal = pickPoint();
    bb.roamTarget = goal;
  }
  return { move: { kind: 'goal', x: goal.x, y: goal.y } };
}

function randomSearchPoint(ctx: GameContext): Vec2 {
  const { width, height } = gameConfig.grid;
  const tx = Math.floor(ctx.rng.next() * width);
  const ty = Math.floor(ctx.rng.next() * height);
  const free = nearestFreeTile(ctx.navObstacles, tx, ty);
  return tileCentre(free.tx, free.ty);
}

/**
 * A random free tile reachable from `centre` **without ever leaving** `radius`.
 *
 * Read off `navObstacles`, not `obstacles`: the terrain grid does not know about
 * base footprints, so drawing from it hands a guard a post inside its own
 * factory. Nothing can drive there — `findPath` snaps such a goal back out, often
 * onto the tile the robot already stands on — and `roamOutcome` only picks a new
 * target once the robot is within `arrivalThreshold` of this one, which it never
 * will be. The robot then holds an unreachable order for the rest of the match.
 * Every destination handed to a robot must come off the grid it drives on.
 * Drawing from the ring's own connected region — rather than any free tile that
 * merely sits inside it — is what actually keeps a guard on station: a spot just
 * across a rock is "within 240 px" yet only reachable by a long detour outside
 * the ring, and the walk there, not the destination, is what abandons the post.
 */
export function randomPointNear(ctx: GameContext, centre: Vec2, radius: number): Vec2 {
  const home = tileOf(centre);
  const start = nearestFreeTile(ctx.navObstacles, home.tx, home.ty);
  const inRing = (t: Tile) => {
    const c = tileCentre(t.tx, t.ty);
    return distance(centre.x, centre.y, c.x, c.y) <= radius;
  };

  const seen = new Set<string>([`${start.tx},${start.ty}`]);
  const reachable: Tile[] = [];
  const queue: Tile[] = [start];
  while (queue.length) {
    // Safe: guarded by `queue.length` on the line above. Not an entity-shape
    // assertion — TS simply can't tie `shift()` to the loop condition.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const cur = queue.shift()!;
    reachable.push(cur);
    for (const [dx, dy] of NEIGHBOURS) {
      const next = { tx: cur.tx + dx, ty: cur.ty + dy };
      const k = `${next.tx},${next.ty}`;
      if (seen.has(k) || isBlockedGrid(ctx.navObstacles, next.tx, next.ty) || !inRing(next)) continue;
      seen.add(k);
      queue.push(next);
    }
  }

  const pick = reachable[ctx.rng.int(reachable.length)];
  return tileCentre(pick.tx, pick.ty);
}

/** Centre of mass of a list of positioned entities (assumed non-empty). */
export function centroidOf(list: readonly Positioned[]): Vec2 {
  let sx = 0;
  let sy = 0;
  for (const r of list) {
    sx += r.position.x;
    sy += r.position.y;
  }
  return { x: sx / list.length, y: sy / list.length };
}
