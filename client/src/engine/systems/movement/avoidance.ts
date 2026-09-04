import { gameConfig } from '../../../config/gameConfig';
import type { Vec2 } from '@drone-directive/types/entities';
import { vecLength } from '../../../utils/math';
import type { RobotEntity } from '../../ecs/archetypes';
import { isAlive } from '../../ecs/guards';

/**
 * Preventive avoidance between robots — the step the pipeline never had.
 *
 * `separationSystem` runs *after* movement and is purely corrective: it pushes
 * apart whatever already overlaps. That is enough to stop robots stacking, and it
 * is exactly what deadlocks a robot walking into one. Measured on a real match
 * driven headless (`.docs/tasks/local-avoidance.md`): a robot drives its full
 * 4.5 px step at a neighbour, separation puts it back 4.5 px along the same line,
 * and the two repeat until the anti-jam retreat fires — 0.9 s later, into the same
 * collision. 47% of retreats have a robot within 30 px, and *every* stall lasting
 * six ticks or more has one within 40 px.
 *
 * The cure is to not drive there in the first place. Pressing into a neighbour
 * head-on is the one approach separation cancels completely; a tangential step is
 * one it barely touches, because the push is only as deep as the overlap.
 *
 * Deliberately not RVO/ORCA: no velocity space, no neighbour prediction, no
 * reciprocity assumption — at these unit counts (tens) the whole defect is
 * "walked into someone", and the cheapest correct answer is to step around them.
 */

/** Deflections tried, in order — smallest first, never past a right angle. */
const FAN = [Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8, Math.PI / 2];

/**
 * The heading to actually drive this tick, or `undefined` when the straight step
 * is clear (the common case, one distance test per neighbour).
 *
 * Returns `undefined` too when nothing in the fan clears: a robot genuinely walled
 * in must still be allowed to press on and let the anti-jam ladder deal with it,
 * or this becomes a new way to freeze.
 */
export function steerAround(
  self: RobotEntity,
  others: readonly RobotEntity[],
  heading: number,
  step: number,
): number | undefined {
  const minDist = gameConfig.robots.radius * 2;
  const pos = self.position;

  const blocker = firstBlocker(self, others, pos, heading, step, minDist);
  if (!blocker) return undefined;

  // Turn away from the side the blocker is on: a robot drifting past my left
  // shoulder is cleared by going right. Dead ahead there is no side to read, so a
  // stable per-robot hash breaks the tie — the house pattern (`evadeSide`,
  // `coincidentAngle`), and what keeps a head-on pair from mirroring each other
  // into the same gap forever.
  const cross = Math.cos(heading) * (blocker.position.y - pos.y) - Math.sin(heading) * (blocker.position.x - pos.x);
  const away = Math.abs(cross) > 1e-3 ? (cross > 0 ? -1 : 1) : preferredSide(self.id);

  for (const offset of FAN) {
    for (const side of [away, -away]) {
      const candidate = heading + side * offset;
      if (!firstBlocker(self, others, pos, candidate, step, minDist)) return candidate;
    }
  }
  return undefined;
}

/** The nearest robot the proposed step would drive into, if any. */
function firstBlocker(
  self: RobotEntity,
  others: readonly RobotEntity[],
  pos: Vec2,
  heading: number,
  step: number,
  minDist: number,
): RobotEntity | undefined {
  const x = pos.x + Math.cos(heading) * step;
  const y = pos.y + Math.sin(heading) * step;
  let best: RobotEntity | undefined;
  let bestDist = Infinity;

  for (const other of others) {
    if (other === self || !isAlive(other)) continue;
    const dx = other.position.x - x;
    const dy = other.position.y - y;
    const d = vecLength(dx, dy);
    if (d >= minDist || d >= bestDist) continue;
    // Already overlapping before the step: separation owns that, and treating it
    // as a blocker would stop a robot escaping the very overlap being resolved.
    if (vecLength(other.position.x - pos.x, other.position.y - pos.y) < minDist) continue;
    best = other;
    bestDist = d;
  }
  return best;
}

/** Stable per-robot turn preference for a head-on meeting (no `Math.random`). */
function preferredSide(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (h & 1) === 0 ? 1 : -1;
}
