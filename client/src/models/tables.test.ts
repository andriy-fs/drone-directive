import { describe, expect, it } from 'vitest';
import { ChassisType, WeaponType } from '@drone-directive/types/enums';
import { CHASSIS, NodeKind, ROBOT_MODELS, WEAPONS, modelBounds, robotParts } from './index';

/**
 * The tax this layer accepts is that a forgotten model makes a unit *invisible* to
 * anyone in a hull, and no rendering test would catch it. The `Record`s are the
 * compile-time half of that insurance; these are the half a type cannot state — that
 * every entry has something in it, that a module ends up on top of the hull rather
 * than inside it, and that every chassis really is a different silhouette.
 */

const chassisTypes = Object.values(ChassisType);
const weaponTypes = Object.values(WeaponType);

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
      expect(modelBounds(hull).x.max, chassis).toBeGreaterThan(10);
    }
  });

  it('stands every hull on the ground it is drawn on', () => {
    // A model is placed at the terrain height under the machine, so anything
    // below z = 0 is a hull sunk into the ground at every position on the map.
    for (const chassis of chassisTypes) {
      expect(modelBounds(CHASSIS[chassis].hull).z.min, chassis).toBe(0);
    }
  });

  it('bolts the module onto the deck rather than into the hull', () => {
    for (const chassis of chassisTypes) {
      const { deck, hull } = CHASSIS[chassis];
      // The deck has to be at the top of the hull: lower and the gun grows out of
      // the machine's flank, higher and it floats above it.
      expect(deck, chassis).toBeCloseTo(modelBounds(hull).z.max, 5);
      const withCannon = ROBOT_MODELS[chassis][WeaponType.Cannon];
      expect(modelBounds(withCannon).z.max, chassis).toBeGreaterThan(deck);
    }
  });

  it('keeps the three chassis apart by silhouette, not just by size', () => {
    const clearance = (c: ChassisType) => modelBounds(CHASSIS[c].hull).z;
    // The walker carries its body off the ground; the other two sit on theirs.
    // That gap is the one difference that survives to the far end of the monitor.
    const legsBody = CHASSIS[ChassisType.Legs].hull.filter((s) => s.node === undefined);
    expect(modelBounds(legsBody).z.min).toBeGreaterThan(8);
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
      expect(modelBounds(barrel).x.max, weapon).toBeGreaterThan(8);
    }
  });
});

describe('robotParts', () => {
  it('adds up to the machine the composed table holds', () => {
    for (const chassis of chassisTypes) {
      for (const weapon of weaponTypes) {
        const { hull, module } = robotParts(chassis, weapon);
        expect([...hull, ...module], `${chassis}/${weapon}`).toEqual(ROBOT_MODELS[chassis][weapon]);
      }
    }
  });

  it('hands the module over already lifted onto the deck', () => {
    // The point of the split is that the two halves can be pointed different ways
    // *in the machine's own frame* — so the module must already be at the height it
    // is drawn at, not still flat at the z = 0 it was authored on.
    const { module, deck } = robotParts(ChassisType.Tracks, WeaponType.Cannon);
    expect(modelBounds(module).z.min).toBeGreaterThanOrEqual(deck);
  });
});
