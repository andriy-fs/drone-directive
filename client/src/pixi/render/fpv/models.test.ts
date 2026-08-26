import { describe, expect, it } from 'vitest';
import { ChassisType, Owner, WeaponType } from '@drone-directive/types/enums';
import { spawnRobot } from '../../../engine/ecs/factory';
import { createEcsWorld } from '../../../engine/ecs/world';
import { CHASSIS, NodeKind, ROBOT_MODELS, WEAPONS, type Model } from './models';
import { baseHeat, robotHeat } from './units';

/**
 * The tax this stage accepts is that a forgotten model makes a unit *invisible* to
 * anyone in a hull, and no rendering test would catch it. The `Record`s are the
 * compile-time half of that insurance; these are the half a type cannot state — that
 * every entry has something in it, that a module ends up on top of the hull rather
 * than inside it, and that every chassis really is a different silhouette.
 */

const chassisTypes = Object.values(ChassisType);
const weaponTypes = Object.values(WeaponType);

/** Extreme of a model along one local axis — what a silhouette actually measures. */
function span(model: Model, axis: 'x' | 'y' | 'z'): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of model) {
    for (const v of [s[`${axis}0`], s[`${axis}1`]]) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max };
}

describe('the model tables', () => {
  it('has a model for every chassis and every weapon', () => {
    for (const chassis of chassisTypes) {
      for (const weapon of weaponTypes) {
        expect(ROBOT_MODELS[chassis]?.[weapon], `${chassis}/${weapon}`).toBeDefined();
      }
    }
  });

  it('gives every chassis a hull of some substance', () => {
    for (const chassis of chassisTypes) {
      const hull = CHASSIS[chassis].hull;
      // Not a threshold anybody should tune — it is there to catch an empty or
      // half-written entry, which is the failure this file exists for.
      expect(hull.length, chassis).toBeGreaterThan(12);
      expect(span(hull, 'x').max, chassis).toBeGreaterThan(10);
    }
  });

  it('stands every hull on the ground it is drawn on', () => {
    // A model is placed at the terrain height under the machine, so anything
    // below z = 0 is a hull sunk into the ground at every position on the map.
    for (const chassis of chassisTypes) {
      expect(span(CHASSIS[chassis].hull, 'z').min, chassis).toBe(0);
    }
  });

  it('bolts the module onto the deck rather than into the hull', () => {
    for (const chassis of chassisTypes) {
      const { deck, hull } = CHASSIS[chassis];
      // The deck has to be at the top of the hull: lower and the gun grows out of
      // the machine's flank, higher and it floats above it.
      expect(deck, chassis).toBeCloseTo(span(hull, 'z').max, 5);
      const withCannon = ROBOT_MODELS[chassis][WeaponType.Cannon];
      expect(span(withCannon, 'z').max, chassis).toBeGreaterThan(deck);
    }
  });

  it('keeps the three chassis apart by silhouette, not just by size', () => {
    const clearance = (c: ChassisType) => span(CHASSIS[c].hull, 'z');
    // The walker carries its body off the ground; the other two sit on theirs.
    // That gap is the one difference that survives to the far end of the monitor.
    const legsBody = CHASSIS[ChassisType.Legs].hull.filter((s) => s.node === undefined);
    expect(span(legsBody, 'z').min).toBeGreaterThan(8);
    expect(clearance(ChassisType.Tracks).max).toBeLessThan(clearance(ChassisType.Legs).max);
  });

  it('marks the parts that get hot, and only on machines that have them', () => {
    for (const chassis of chassisTypes) {
      expect(CHASSIS[chassis].hull.some((s) => s.node === NodeKind.Engine), chassis).toBe(true);
      const drive = CHASSIS[chassis].hull.some((s) => s.node === NodeKind.Wheel || s.node === NodeKind.Joint);
      expect(drive, chassis).toBe(true);
    }
    // A gun has a barrel; a sensor and a jammer never fire and must not glow.
    expect(WEAPONS[WeaponType.Cannon].some((s) => s.node === NodeKind.Barrel)).toBe(true);
    expect(WEAPONS[WeaponType.Missiles].some((s) => s.node === NodeKind.Barrel)).toBe(true);
    expect(WEAPONS[WeaponType.Radar].some((s) => s.node !== undefined)).toBe(false);
    expect(WEAPONS[WeaponType.Ew].some((s) => s.node !== undefined)).toBe(false);
    // An empty hardpoint is a real state, and it is drawn as nothing at all.
    expect(WEAPONS[WeaponType.None]).toHaveLength(0);
  });

  it('points every directional module forward', () => {
    // The cannon's barrel and the launcher's tubes reach out over the nose; a model
    // built with the sign flipped would leave every gun in the game aimed astern.
    for (const weapon of [WeaponType.Cannon, WeaponType.Missiles]) {
      const barrel = WEAPONS[weapon].filter((s) => s.node === NodeKind.Barrel);
      expect(span(barrel, 'x').max, weapon).toBeGreaterThan(8);
    }
  });
});

describe('heat', () => {
  const world = createEcsWorld();
  const robot = () => spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Tracks, WeaponType.Cannon);

  it('is cold on a machine that is parked and loaded', () => {
    expect(robotHeat(robot())).toEqual({ drive: 0, barrel: 0 });
  });

  it('reads a just-fired gun as hot and a cooling one as fading', () => {
    const r = robot();
    r.weapon.cooldownLeft = r.weapon.cooldown;
    expect(robotHeat(r).barrel).toBe(1);
    r.weapon.cooldownLeft = r.weapon.cooldown / 4;
    expect(robotHeat(r).barrel).toBeCloseTo(0.25, 5);
    r.weapon.cooldownLeft = 0;
    expect(robotHeat(r).barrel).toBe(0);
  });

  it('never lights a weapon that cannot fire', () => {
    // A radar's cooldown is zero, and dividing by it would leave every scout in
    // the game glowing permanently.
    const scout = spawnRobot(world, Owner.Player, { x: 0, y: 0 }, ChassisType.Wheels, WeaponType.Radar);
    scout.weapon.cooldownLeft = 3;
    expect(robotHeat(scout).barrel).toBe(0);
  });

  it('reads the drive against what the chassis can actually do', () => {
    const r = robot();
    r.movement.velX = r.movement.speed;
    expect(robotHeat(r).drive).toBe(1);
    r.movement.velX = r.movement.speed / 2;
    expect(robotHeat(r).drive).toBeCloseTo(0.5, 5);
    // Diagonal travel is the same ground speed, not 1.4× of it.
    const half = (r.movement.speed / 2) * Math.SQRT1_2;
    r.movement.velX = half;
    r.movement.velY = half;
    expect(robotHeat(r).drive).toBeCloseTo(0.5, 5);
  });

  it('clamps a hull shoved past its own top speed', () => {
    // `separationSystem` can push a hull further than it drove itself, and an
    // alpha above 1 is a stroke Pixi silently clamps — better to clamp it here.
    const r = robot();
    r.movement.velX = r.movement.speed * 3;
    expect(robotHeat(r).drive).toBe(1);
  });

  it('gives a base a barrel but no drive', () => {
    const base = { weapon: { cooldown: 4, cooldownLeft: 2 } };
    expect(baseHeat(base as Parameters<typeof baseHeat>[0])).toEqual({ drive: 0, barrel: 0.5 });
  });
});
