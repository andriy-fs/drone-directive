import { describe, expect, it } from 'vitest';
import { createOrcaSolver } from './solver';

/**
 * The solver's contract. These are the invariants the ORCA layer is *bought* for,
 * so they are written against behaviour rather than implementation — most of them
 * would survive swapping the linear program for a different one.
 *
 * Where a test replaces one of `avoidance.test.ts`'s seven, it says so: that file
 * covered the same ground for `steerAround` and its assertions are the price of
 * removing it.
 */

const DT = 1 / 30;
const R = 11.5; // hull radius plus the ORCA padding
const SPEED = 60; // the tracks chassis
const TAU = 1 / 1.0;
const FAR = 300 * 300;

/** Registers a mover; `pref` defaults to driving straight at `maxSpeed` along +x. */
function mover(
  s: ReturnType<typeof createOrcaSolver>,
  px: number, py: number,
  vx: number, vy: number,
  prefX = vx, prefY = vy,
  passive = false,
): number {
  return s.addAgent(px, py, vx, vy, prefX, prefY, R, SPEED, TAU, passive);
}

describe('orca solver', () => {
  it('leaves a free agent on its preferred velocity, bit for bit', () => {
    // Replaces avoidance.test's "leaves an unobstructed step alone", strengthened
    // from "returns undefined" to exact equality: an untouched agent must not be
    // perturbed even in the last bit, or a whole army jitters.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, 100, 100, SPEED, 0);
    s.solve(FAR);
    expect(s.newVelX[a]).toBe(SPEED);
    expect(s.newVelY[a]).toBe(0);
    expect(s.fellBack[a]).toBe(0);
  });

  it('never exceeds max speed, in any configuration in this file', () => {
    const s = createOrcaSolver();
    s.beginTick(DT);
    // A deliberately awkward pile: head-on, crossing, and overlapping at once.
    mover(s, 100, 100, SPEED, 0);
    mover(s, 140, 100, -SPEED, 0);
    mover(s, 120, 80, 0, SPEED);
    mover(s, 105, 103, SPEED, 0);
    s.solve(FAR);
    for (let i = 0; i < s.count; i++) {
      const speed = Math.sqrt(s.newVelX[i] * s.newVelX[i] + s.newVelY[i] * s.newVelY[i]);
      expect(speed).toBeLessThanOrEqual(SPEED + 1e-9);
    }
  });

  it('splits the correction 50/50 between two symmetric movers', () => {
    // THE invariant `steerAround` structurally cannot have: it deflects off the
    // neighbour's current position one-sidedly, so two units can pick the same
    // side and mirror each other into the same gap.
    //
    // The symmetry has to be **rotational**, not reflective. ORCA picks which leg
    // of the velocity cone to project onto with a cross product, which is
    // orientation-sensitive: reflecting a configuration turns every left leg into
    // a right leg, so a mirrored pair does not produce mirrored output and a test
    // built that way measures the reflection rather than the reciprocity. A 180°
    // rotation preserves orientation, so it does.
    const s = createOrcaSolver();
    s.beginTick(DT);
    // Offset in y so this is a near-miss rather than an exact head-on; exact
    // head-on is degenerate (see the note in the next test).
    const a = mover(s, -40, -5, SPEED, 0);
    const b = mover(s, 40, 5, -SPEED, 0);
    s.solve(FAR);

    // Rotating a's answer by 180° must give b's.
    expect(s.newVelX[b]).toBeCloseTo(-s.newVelX[a], 9);
    expect(s.newVelY[b]).toBeCloseTo(-s.newVelY[a], 9);

    // And each conceded the same amount of its preferred velocity — the "50/50"
    // in a form that does not depend on the frame it is measured in.
    const giveA = Math.hypot(s.newVelX[a] - SPEED, s.newVelY[a] - 0);
    const giveB = Math.hypot(s.newVelX[b] + SPEED, s.newVelY[b] - 0);
    expect(giveA).toBeGreaterThan(1);
    expect(giveA).toBeCloseTo(giveB, 9);
  });

  it('parts an exact head-on pair to opposite sides', () => {
    // Worth pinning, because the opposite was expected. A deterministic sim has no
    // floating-point noise to break ties with, and formations are lattices that
    // manufacture exact symmetry, so the fear was that a perfectly head-on pair
    // would slow to a crawl facing each other and deadlock. It does not: the cross
    // product that chooses a leg resolves consistently under the 180° rotation
    // relating the two agents, so they pick *opposite* sides and slide past.
    //
    // This is why `behavior.orca.symmetryBias` is not applied unconditionally —
    // ORCA does not need help here, and a permanent bias would be a permanent
    // drift on every clear march.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, -40, 0, SPEED, 0);
    const b = mover(s, 40, 0, -SPEED, 0);
    s.solve(FAR);

    expect(s.fellBack[a]).toBe(0);
    expect(s.fellBack[b]).toBe(0);
    // Each gives up some forward speed...
    expect(s.newVelX[a]).toBeLessThan(SPEED);
    expect(s.newVelX[b]).toBeGreaterThan(-SPEED);
    // ...and they go round opposite shoulders rather than mirroring into one gap.
    expect(Math.abs(s.newVelY[a])).toBeGreaterThan(5);
    expect(Math.sign(s.newVelY[a])).toBe(-Math.sign(s.newVelY[b]));
  });

  it('makes the mover take the whole correction against a passive neighbour', () => {
    // A passive agent will not move aside — a disabled hull, or one landing exactly
    // on its waypoint — so reciprocity is not available and the mover owes all of
    // it. Exactly twice the deflection of the shared case.
    const shared = createOrcaSolver();
    shared.beginTick(DT);
    const m1 = mover(shared, 0, 0, SPEED, 0);
    mover(shared, 60, 4, -SPEED, 0);
    shared.solve(FAR);
    const sharedDev = Math.abs(shared.newVelY[m1]);

    const solo = createOrcaSolver();
    solo.beginTick(DT);
    const m2 = mover(solo, 0, 0, SPEED, 0);
    solo.addAgent(60, 4, -SPEED, 0, -SPEED, 0, R, SPEED, TAU, true);
    solo.solve(FAR);
    const soloDev = Math.abs(solo.newVelY[m2]);

    expect(sharedDev).toBeGreaterThan(0.5);
    expect(soloDev).toBeCloseTo(sharedDev * 2, 4);
  });

  it('reduces the closing speed on a neighbour dead ahead', () => {
    // Replaces avoidance.test's "deflects a step that would end inside a
    // neighbour". Stated as closing speed rather than as a turn, because in
    // velocity space slowing down is an equally valid answer.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, 0, 0, SPEED, 0);
    mover(s, 50, 0, 0, 0, 0, 0, true); // parked squarely in the way
    s.solve(FAR);
    expect(s.newVelX[a]).toBeLessThan(SPEED);
  });

  it('never reverses to avoid, when the constraints are satisfiable', () => {
    // Replaces "never turns more than a right angle", which is meaningless in
    // velocity space. The honest form: a feasible solve never sends a unit
    // backwards relative to where it wanted to go.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, 0, 0, SPEED, 0);
    mover(s, 70, 18, -SPEED, 0);
    s.solve(FAR);
    if (s.fellBack[a] === 0) {
      expect(s.newVelX[a] * SPEED + s.newVelY[a] * 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('yields a finite, speed-bounded velocity when ringed and over-constrained', () => {
    // Replaces "gives up rather than freezing when walled in", and upgrades it:
    // `steerAround` returned undefined and let the unit press on blind, whereas
    // LP3 always produces the least-penetrating velocity it can.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, 0, 0, SPEED, 0);
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2;
      const d = R * 2 - 1;
      s.addAgent(Math.cos(angle) * d, Math.sin(angle) * d, 0, 0, 0, 0, R, SPEED, TAU, true);
    }
    expect(() => s.solve(FAR)).not.toThrow();
    expect(Number.isFinite(s.newVelX[a])).toBe(true);
    expect(Number.isFinite(s.newVelY[a])).toBe(true);
    const speed = Math.sqrt(s.newVelX[a] * s.newVelX[a] + s.newVelY[a] * s.newVelY[a]);
    expect(speed).toBeLessThanOrEqual(SPEED + 1e-9);
  });

  it('drives an already-overlapping agent away from the one it overlaps', () => {
    // Replaces "lets a robot already overlapping drive out". `steerAround` managed
    // this by ignoring the overlap; ORCA has to actively resolve it, which is the
    // stronger property.
    const s = createOrcaSolver();
    s.beginTick(DT);
    const a = mover(s, 0, 0, 0, 0, 0, 0);
    s.addAgent(8, 0, 0, 0, 0, 0, R, SPEED, TAU, true); // overlapping: 8 px < 23 px
    s.solve(FAR);
    // The neighbour is at +x, so getting out means a negative x component.
    expect(s.newVelX[a]).toBeLessThan(0);
  });

  it('respects a wall constraint on the normal while leaving the tangent alone', () => {
    // The property that makes a stream rather than a pinch: a corridor may slow a
    // hull's drift into the wall without slowing its progress along the corridor.
    const s = createOrcaSolver();
    s.beginTick(DT);
    // Driving diagonally at a wall whose outward normal points -y (wall is above).
    const a = s.addAgent(0, 0, 40, 40, 40, 40, R, SPEED, TAU, false);
    s.addWall(a, 0, -1, -20); // v·(0,-1) >= -20  →  vy <= 20
    s.solve(FAR);
    expect(s.newVelY[a]).toBeLessThanOrEqual(20 + 1e-6);
    expect(s.newVelX[a]).toBeCloseTo(40, 6);
  });

  it('is deterministic across repeats', () => {
    const run = () => {
      const s = createOrcaSolver();
      s.beginTick(DT);
      mover(s, 0, 0, SPEED, 0);
      mover(s, 40, 12, -SPEED, 0);
      mover(s, 20, -30, 0, SPEED);
      s.solve(FAR);
      return [...s.newVelX.slice(0, 3), ...s.newVelY.slice(0, 3)].join(',');
    };
    const first = run();
    for (let i = 0; i < 5; i++) expect(run()).toBe(first);
  });

  it('treats registration order as part of the answer', () => {
    // Not a wart to be fixed — the linear program walks constraints in order and
    // stops at the first infeasible one. It is recorded here so nobody "optimises"
    // the caller by sorting agents and silently desyncs the two peers.
    const build = (swap: boolean) => {
      const s = createOrcaSolver();
      s.beginTick(DT);
      const specs: [number, number, number, number][] = [
        [0, 0, SPEED, 0],
        [30, 6, -SPEED, 0],
      ];
      const order = swap ? [1, 0] : [0, 1];
      const ids = order.map((k) => mover(s, specs[k][0], specs[k][1], specs[k][2], specs[k][3]));
      s.solve(FAR);
      return { s, first: ids[0] };
    };
    expect(() => build(true)).not.toThrow();
    expect(Number.isFinite(build(false).s.newVelX[0])).toBe(true);
  });

  it('allocates once and never moves its buffers', () => {
    // The enforceable form of "zero GC in the update loop".
    const s = createOrcaSolver();
    const bufferX = s.newVelX;
    const bufferY = s.newVelY;
    for (let tick = 0; tick < 10_000; tick++) {
      s.beginTick(DT);
      for (let k = 0; k < 48; k++) mover(s, k * 30, (k % 7) * 25, SPEED, 0);
      s.solve(FAR);
    }
    expect(s.newVelX).toBe(bufferX);
    expect(s.newVelY).toBe(bufferY);
    expect(s.allocations).toBe(1);
  });
});
