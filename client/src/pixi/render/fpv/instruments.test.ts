import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { createEcsWorld } from '../../../engine/ecs/world';
import { spawnRobot } from '../../../engine/ecs/factory';
import { viewProjection } from './camera';
import { bearingMark, gauges, headingTicks } from './instruments';

const W = 800;
const H = 600;
/** A hull facing east — heading 0 — on flat ground. */
const facingEast = { x: 1000, y: 1000, heading: 0, ground: 0 };
const view = viewProjection(facingEast, W, H);

describe('the heading tape', () => {
  it('puts the direction the camera is looking at the middle of the screen', () => {
    const ticks = headingTicks(view, 0, W);
    const centre = ticks.reduce((best, t) => (Math.abs(t.x - W / 2) < Math.abs(best.x - W / 2) ? t : best));
    expect(centre.x).toBeCloseTo(W / 2, 3);
    // Heading 0 is east, and east is a cardinal — so the tick in the middle is
    // labelled, which is the whole convention this file owns.
    expect(centre.glyph).toBe('E');
  });

  it('runs clockwise on the screen — rising azimuth goes right', () => {
    // World y runs south, so turning right from east arrives at south. The ticks
    // come out in rising azimuth, so a mirrored compass would come out sorted the
    // other way.
    const ticks = headingTicks(view, 0, W);
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThan(ticks[i - 1].x);
  });

  it('shows at most one cardinal, because the field is narrower than the gap between them', () => {
    // The monitor sees about ±40° horizontally and the cardinals are 90° apart, so
    // a tape carrying two of them at once would mean the projection had gone wrong.
    for (const heading of [0, 0.4, Math.PI / 4, 1.2, -2.9]) {
      const turned = viewProjection({ ...facingEast, heading }, W, H);
      expect(headingTicks(turned, heading, W).filter((t) => t.glyph).length).toBeLessThanOrEqual(1);
    }
  });

  it('spaces ticks wider toward the edges than a flat degrees-to-pixels ruler would', () => {
    // The tape is projected, not laid out: perspective stretches the same angular
    // step as it moves off centre. A linear tape would make these equal.
    const ticks = headingTicks(view, 0, W);
    const mid = ticks.findIndex((t) => Math.abs(t.x - W / 2) < 1);
    const inner = ticks[mid + 1].x - ticks[mid].x;
    const outer = ticks[ticks.length - 1].x - ticks[ticks.length - 2].x;
    expect(outer).toBeGreaterThan(inner);
  });

  it('shows only what fits on the canvas', () => {
    const ticks = headingTicks(view, 0, W);
    expect(ticks.length).toBeGreaterThan(4);
    for (const t of ticks) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(W);
    }
  });

  it('carries the tape round with the camera', () => {
    const heading = 2.4;
    const turned = viewProjection({ ...facingEast, heading }, W, H);
    const ticks = headingTicks(turned, heading, W);
    const centre = ticks.reduce((best, t) => (Math.abs(t.x - W / 2) < Math.abs(best.x - W / 2) ? t : best));
    // 2.4 rad is 137.5°, so the nearest whole ten-degree tick is 140 — a little
    // right of the middle, not at it.
    expect(Math.abs(centre.x - W / 2)).toBeLessThan(W / 4);
  });
});

describe('the bearing mark', () => {
  it('lands on the tape when the place is ahead', () => {
    const mark = bearingMark(view, 0, { x: 1000, y: 1000 }, { x: 4000, y: 1000 }, W);
    expect(mark.edge).toBe(0);
    expect(mark.x).toBeCloseTo(W / 2, 0);
  });

  it('is a bearing, not a place — distance along it does not move the mark', () => {
    const near = bearingMark(view, 0, { x: 1000, y: 1000 }, { x: 1600, y: 1300 }, W);
    const far = bearingMark(view, 0, { x: 1000, y: 1000 }, { x: 5000, y: 3000 }, W);
    expect(near.edge).toBe(0);
    expect(near.x).toBeCloseTo(far.x, 0);
  });

  it('pins to the right edge for a place off to the right, and the left for the left', () => {
    const from = { x: 1000, y: 1000 };
    // Facing east: due south is the pilot's right, due north their left.
    const right = bearingMark(view, 0, from, { x: 1000, y: 9000 }, W);
    const left = bearingMark(view, 0, from, { x: 1000, y: -9000 }, W);
    expect(right.edge).toBe(1);
    expect(left.edge).toBe(-1);
    expect(right.x).toBeGreaterThan(W / 2);
    expect(left.x).toBeLessThan(W / 2);
  });

  it('pins astern to an edge rather than dropping the mark', () => {
    const behind = bearingMark(view, 0, { x: 1000, y: 1000 }, { x: -5000, y: 1000 }, W);
    expect(behind.edge).not.toBe(0);
  });
});

describe('the gauges', () => {
  const world = createEcsWorld();
  const hull = () => spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);

  it('reads a fresh hull as whole, loaded and parked', () => {
    const g = gauges(hull());
    expect(g.integrity).toBe(1);
    expect(g.reload).toBe(1); // nothing fired yet, so the gun is ready
    expect(g.drive).toBe(0);
  });

  it('empties the reload the instant a round leaves and fills it as the gun cools', () => {
    const robot = hull();
    robot.weapon.cooldownLeft = robot.weapon.cooldown;
    expect(gauges(robot).reload).toBe(0);
    robot.weapon.cooldownLeft = robot.weapon.cooldown / 2;
    expect(gauges(robot).reload).toBeCloseTo(0.5, 6);
  });

  it('reads the drive off the velocity the pilot actually drove', () => {
    const robot = hull();
    robot.movement.velX = robot.movement.speed;
    expect(gauges(robot).drive).toBeCloseTo(1, 6);
  });

  it('stays inside 0..1 for a hull shoved past its own top speed', () => {
    // `separationSystem` can push a robot faster than it can drive itself.
    const robot = hull();
    robot.movement.velX = robot.movement.speed * 3;
    robot.hp = -5;
    const g = gauges(robot);
    expect(g.drive).toBe(1);
    expect(g.integrity).toBe(0);
  });

  it('does not light a permanent reload bar on a weapon that never fires', () => {
    const robot = spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.None);
    expect(gauges(robot).reload).toBe(1);
  });
});
