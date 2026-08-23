import { describe, expect, it } from 'vitest';
import { DustTrail, MAX_PUFFS, puffAlpha, puffRadius, type DustSpec } from './dust';

const SPEC: DustSpec = { spacing: 10, radius: 3, life: 0.5, spread: 8, offset: 12, alpha: 0.4 };

/** One frame at 60 Hz, the rate the renderer actually calls `advance` at. */
const DT = 1 / 60;

describe('DustTrail', () => {
  it('lays down nothing while the unit is standing still', () => {
    // The whole point of clocking on distance: a parked unit must not smoke, and
    // that has to hold no matter how long it stands there.
    const trail = new DustTrail();
    for (let i = 0; i < 200; i++) trail.advance(DT, 0, 0, 0, 0, SPEC);
    expect(trail.puffs).toHaveLength(0);
  });

  it('lays down one puff per spacing of travel', () => {
    const trail = new DustTrail();
    // Four spacings' worth of ground, one frame at a time, with a life long enough
    // that none of them expires while we count.
    const spec = { ...SPEC, life: 100 };
    for (let i = 0; i < 40; i++) trail.advance(DT, 1, 0, 0, 0, spec);
    expect(trail.puffs).toHaveLength(4);
  });

  it('drops a puff behind the unit and alternates sides', () => {
    const trail = new DustTrail();
    const spec = { ...SPEC, life: 100 };
    // Heading 0 is +x, so "behind" is -x and the two emission points differ in y.
    trail.advance(DT, spec.spacing, 100, 100, 0, spec);
    trail.advance(DT, spec.spacing, 100, 100, 0, spec);
    const [first, second] = trail.puffs;
    expect(first.x).toBeLessThan(100);
    expect(second.x).toBeLessThan(100);
    expect(Math.sign(first.y - 100)).toBe(-Math.sign(second.y - 100));
  });

  it('leaves a puff where it was laid down, however far the unit travels on', () => {
    // A trail that follows the unit is not a trail. This is the property the
    // world-space coordinates exist for.
    const trail = new DustTrail();
    const spec = { ...SPEC, life: 100 };
    trail.advance(DT, spec.spacing, 0, 0, 0, spec);
    const born = { ...trail.puffs[0] };
    for (let i = 1; i < 5; i++) trail.advance(DT, 1, i * 20, i * 20, 0, spec);
    expect(trail.puffs[0].x).toBe(born.x);
    expect(trail.puffs[0].y).toBe(born.y);
  });

  it('forgets a puff once it has faded', () => {
    const trail = new DustTrail();
    trail.advance(DT, SPEC.spacing, 0, 0, 0, SPEC);
    expect(trail.puffs).toHaveLength(1);
    // Age it past its life with no further travel, so nothing new is emitted.
    for (let i = 0; i < 60; i++) trail.advance(DT, 0, 0, 0, 0, SPEC);
    expect(trail.puffs).toHaveLength(0);
  });

  it('never holds more than the ceiling, even at an absurd emission rate', () => {
    const trail = new DustTrail();
    const spec = { ...SPEC, life: 100 };
    for (let i = 0; i < 500; i++) trail.advance(DT, spec.spacing, i, 0, 0, spec);
    expect(trail.puffs.length).toBeLessThanOrEqual(MAX_PUFFS);
  });

  it('emits at most one puff per frame, however much ground a frame covered', () => {
    // A resumed tab or a teleport hands `advance` a huge step; laying down the
    // whole backlog would stamp a pile of clouds on one spot.
    const trail = new DustTrail();
    trail.advance(DT, SPEC.spacing * 50, 0, 0, 0, SPEC);
    expect(trail.puffs).toHaveLength(1);
  });
});

describe('puff fade', () => {
  it('starts opaque at the spec alpha and reaches zero at the end of its life', () => {
    const trail = new DustTrail();
    trail.advance(DT, SPEC.spacing, 0, 0, 0, SPEC);
    const puff = trail.puffs[0];
    expect(puffAlpha(puff, SPEC)).toBeCloseTo(SPEC.alpha, 5);

    puff.age = puff.life;
    expect(puffAlpha(puff, SPEC)).toBe(0);
  });

  it('spreads as it ages', () => {
    const trail = new DustTrail();
    trail.advance(DT, SPEC.spacing, 0, 0, 0, SPEC);
    const puff = trail.puffs[0];
    const fresh = puffRadius(puff);
    puff.age = puff.life * 0.5;
    expect(puffRadius(puff)).toBeGreaterThan(fresh);
  });
});
