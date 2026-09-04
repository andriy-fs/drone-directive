import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { gameConfig } from '../../../config/gameConfig';
import type { RobotEntity } from '../../ecs/archetypes';
import { spawnRobot } from '../../ecs/factory';
import { makeCtx } from '../testkit';
import { steerAround } from './avoidance';

/**
 * The invariant these hold is the one that cost 47% of every anti-jam retreat:
 * a robot must not drive into ground a neighbour is standing on, because
 * `separationSystem` will put it straight back and the pair will do it again
 * until the retreat fires. See `.docs/tasks/local-avoidance.md`.
 */

const R = gameConfig.robots.radius;
const STEP = 4.5; // one tick of the `wheels` chassis

function robot(id: string, x: number, y: number): RobotEntity {
  const ctx = makeCtx(1);
  const e = spawnRobot(ctx.world, Owner.Player, { x, y }, ChassisType.Tracks, WeaponType.Cannon);
  e.id = id;
  return e as RobotEntity;
}

describe('steerAround', () => {
  it('leaves an unobstructed step alone', () => {
    const self = robot('a', 100, 100);
    const other = robot('b', 400, 400);
    expect(steerAround(self, [other], 0, STEP)).toBeUndefined();
  });

  it('deflects a step that would end inside a neighbour', () => {
    const self = robot('a', 100, 100);
    // Dead ahead, just beyond the step: driving straight lands inside its hull.
    const other = robot('b', 100 + STEP + R * 2 - 1, 100);
    const steered = steerAround(self, [other], 0, STEP);
    expect(steered).toBeDefined();
    expect(steered).not.toBe(0);
  });

  it('never turns more than a right angle — a deflection is not a retreat', () => {
    const self = robot('a', 100, 100);
    const other = robot('b', 100 + STEP + R * 2 - 1, 100);
    const steered = steerAround(self, [other], 0, STEP) ?? 0;
    expect(Math.abs(steered)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
  });

  it('turns away from the side the neighbour is on', () => {
    const self = robot('a', 100, 100);
    // Off the left shoulder (screen y grows downward, so -y is left of +x), far
    // enough not to be overlapping yet — the step is what puts them in contact.
    const left = robot('b', 120, 90);
    const steered = steerAround(self, [left], 0, STEP);
    expect(steered).toBeDefined();
    expect(steered ?? 0).toBeGreaterThan(0); // ...so it goes right
  });

  it('is deterministic: identical inputs, identical answer', () => {
    const self = robot('a', 100, 100);
    const other = robot('b', 100 + STEP + R * 2 - 1, 100);
    const first = steerAround(self, [other], 0, STEP);
    for (let i = 0; i < 5; i++) expect(steerAround(self, [other], 0, STEP)).toBe(first);
  });

  it('gives up rather than freezing when it is walled in by neighbours', () => {
    const self = robot('a', 100, 100);
    const ring: RobotEntity[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ring.push(robot(`r${i}`, 100 + Math.cos(a) * (STEP + R * 2 - 1), 100 + Math.sin(a) * (STEP + R * 2 - 1)));
    }
    // No heading clears, so the caller is told to carry on: the anti-jam ladder
    // owns a genuinely trapped robot, and this must not become a second way to
    // freeze one.
    expect(steerAround(self, ring, 0, STEP)).toBeUndefined();
  });

  it('lets a robot already overlapping drive out instead of pinning it', () => {
    // Separation owns an existing overlap. Treating the neighbour as a blocker
    // here would stop the robot leaving the very overlap being resolved.
    const self = robot('a', 100, 100);
    const other = robot('b', 100 + R, 100);
    expect(steerAround(self, [other], 0, STEP)).toBeUndefined();
  });
});
