import { describe, expect, it } from 'vitest';
import {
  MAX_PARTICLES,
  MAX_SCORCH,
  ParticleField,
  ParticleKind,
  particleAlpha,
  particleRadius,
  type BurstSpec,
} from './particles';

/** One frame at 60 Hz, the rate the renderer actually calls `advance` at. */
const DT = 1 / 60;

const BURST: BurstSpec = {
  count: 6,
  speed: 100,
  speedSpread: 0.4,
  cone: 0.5,
  length: 6,
  life: 0.3,
  color: 0xffffff,
  alpha: 1,
};

describe('ParticleField', () => {
  it('drops a particle the frame its life runs out', () => {
    const field = new ParticleField();
    field.flash(0, 0, 5, 0.1, 0xffffff);
    for (let i = 0; i < 5; i++) field.advance(DT);
    expect(field.particles).toHaveLength(1);
    for (let i = 0; i < 5; i++) field.advance(DT);
    expect(field.particles).toHaveLength(0);
  });

  it('never grows past its ceiling, however hard it is emitted into', () => {
    // The pathological case the cap exists for: a resumed tab, or twenty units
    // firing into one spot. Oldest out first, so what is on screen stays current.
    const field = new ParticleField();
    for (let i = 0; i < MAX_PARTICLES * 3; i++) field.flash(i, 0, 4, 10, 0xffffff);
    expect(field.particles).toHaveLength(MAX_PARTICLES);
    // The survivors are the newest, not the first ones emitted.
    expect(field.particles[0].x).toBe(MAX_PARTICLES * 2);
  });

  it('caps scorch marks separately from airborne particles', () => {
    const field = new ParticleField();
    for (let i = 0; i < MAX_SCORCH * 2; i++) field.scorch(i, 0, 10, 10, 0x000000, 0.5);
    expect(field.scorches).toHaveLength(MAX_SCORCH);
    expect(field.particles).toHaveLength(0);
  });

  it('throws a burst inside the cone it is given, and no wider', () => {
    // The cone is what makes an impact say which direction the fire came from,
    // so a spark outside it is not a cosmetic slip — it is wrong information.
    const field = new ParticleField();
    const dir = Math.PI / 2;
    field.burst(0, 0, dir, { ...BURST, count: 60, cone: 0.4 });
    for (const p of field.particles) {
      const a = Math.atan2(p.vy, p.vx);
      // Wrapped into (-π, π] so the comparison holds across the seam.
      const off = Math.atan2(Math.sin(a - dir), Math.cos(a - dir));
      expect(Math.abs(off)).toBeLessThanOrEqual(0.4 + 1e-9);
    }
  });

  it('slows sparks by the same fraction per second regardless of frame length', () => {
    // Framerate-independent drag. Without it a spark travels visibly further on
    // a slow machine, which is the one way this layer could disagree with itself
    // between two clients watching the same match.
    const fine = new ParticleField();
    const coarse = new ParticleField();
    const spec = { ...BURST, count: 1, cone: 0, speedSpread: 0, life: 100 };
    fine.burst(0, 0, 0, spec);
    coarse.burst(0, 0, 0, spec);
    for (let i = 0; i < 60; i++) fine.advance(1 / 60);
    for (let i = 0; i < 6; i++) coarse.advance(1 / 6);
    expect(fine.particles[0].vx).toBeCloseTo(coarse.particles[0].vx, 4);
  });

  it('grows smoke as it fades and shrinks a flash as it dies', () => {
    // The two curves are opposites on purpose: smoke disperses, a flash collapses.
    const field = new ParticleField();
    field.smoke(0, 0, 10, 1, 0x888888, 1);
    field.flash(0, 0, 10, 1, 0xffffff);
    const [smoke, flash] = field.particles;
    field.advance(0.5);
    expect(particleRadius(smoke)).toBeGreaterThan(10);
    expect(particleRadius(flash)).toBeLessThan(10);
  });

  it('holds a scorch mark at full strength before weathering it away at the end', () => {
    // A burn does not fade gradually — it sits there and then gets rained on.
    const field = new ParticleField();
    field.scorch(0, 0, 20, 3, 0x000000, 0.5);
    const mark = field.scorches[0];
    field.advance(1.5);
    expect(particleAlpha(mark)).toBeCloseTo(0.5, 5);
    field.advance(1.3);
    expect(particleAlpha(mark)).toBeLessThan(0.3);
  });

  it('drops everything on clear, so a new match does not open under the smoke of the last', () => {
    const field = new ParticleField();
    field.burst(0, 0, 0, BURST);
    field.scorch(0, 0, 10, 10, 0x000000, 0.5);
    field.clear();
    expect(field.particles).toHaveLength(0);
    expect(field.scorches).toHaveLength(0);
  });

  it('reports zero alpha for a spent particle rather than a negative one', () => {
    const field = new ParticleField();
    field.smoke(0, 0, 5, 0.1, 0x888888, 1);
    const p = field.particles[0];
    field.advance(0.2);
    expect(particleAlpha(p)).toBe(0);
    expect(p.kind).toBe(ParticleKind.Smoke);
  });
});
