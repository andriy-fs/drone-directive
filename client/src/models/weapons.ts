import { WeaponType } from '@drone-directive/types/enums';
import { NodeKind, type Model } from './segment';
import { box, plate, ring, seg, tube } from './primitives';

/**
 * Every weapon module, exhaustively, authored flat at `z = 0` and lifted onto a
 * chassis's deck by `robots.ts`.
 *
 * Each one is the *dominant form* its sprite brief names and nothing else: the
 * cannon is one long barrel, the launcher is two fat tubes with open mouths, the
 * jammer is an X of four aerials, the emitter is a ring, the carrier is a
 * perforated canister. At 30 px the art has room for three or four shapes; a
 * wireframe at range has room for fewer, so the dominant form is what each model
 * leads with — and then the workings that make a gun read as *that* gun: a muzzle
 * brake, a warhead showing at a mouth, a feed horn at the dish's focus.
 */
export const WEAPONS: Record<WeaponType, Model> = {
  // An empty hardpoint is a real state, not a missing entry.
  [WeaponType.None]: [],

  /** One thick barrel down the long axis, on a breech block. The baseline gun. */
  [WeaponType.Cannon]: [
    ...plate(14, 14, 0),
    ...box(22, 4, 3, 7, 11, 0, NodeKind.Barrel),
    // Breech and mantlet: the mass the barrel comes out of.
    ...box(10, 10, 2, 8, -2, 0),
    seg(3, -6, 2, 3, -6, 8),
    seg(3, 6, 2, 3, 6, 8),
    // Bore evacuator partway along, muzzle brake at the end.
    ...box(5, 6, 2.5, 7.5, 12, 0, NodeKind.Barrel),
    ...box(4, 7, 2, 8, 22, 0, NodeKind.Barrel),
  ],

  /** Two fat tubes with dark mouths — heavier than the cannon, and it has to look it. */
  [WeaponType.Missiles]: [
    ...plate(14, 16, 0),
    ...tube(20, 6, 2, 8, 8, -5, NodeKind.Barrel),
    ...tube(20, 6, 2, 8, 8, 5, NodeKind.Barrel),
    // The armoured pod the tubes are set in, and the sight on top of it.
    ...box(14, 18, 1, 9, 0, 0),
    ...box(6, 6, 9, 13, 0, 0),
    // A warhead showing at each mouth, and the blast deflectors behind.
    seg(18, -5, 5, 21, -5, 5, NodeKind.Barrel),
    seg(18, 5, 5, 21, 5, 5, NodeKind.Barrel),
    seg(-7, -7, 2, -7, -3, 8),
    seg(-7, 7, 2, -7, 3, 8),
  ],

  /** The payload in its clamp ring, under a hazard cross. No barrel: this one *is* the round. */
  [WeaponType.Bomb]: [
    ...ring(13, 4, 8, NodeKind.Barrel),
    seg(-9, -9, 4, 9, 9, 4, NodeKind.Barrel),
    seg(-9, 9, 4, 9, -9, 4, NodeKind.Barrel),
    seg(0, 0, 0, 0, 0, 13, NodeKind.Barrel),
    ...plate(10, 10, 0),
    // The round itself, inside the clamp. A dozen segments for a shape the ring
    // and the cross already announce at range.
    ...box(6, 6, 1, 11, 0, 0, NodeKind.Barrel),
    // Four pylons out to the ring: what holds the round rather than what it is.
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2;
      return seg(Math.cos(a) * 5, Math.sin(a) * 5, 1, Math.cos(a) * 12, Math.sin(a) * 12, 6);
    }),
  ],

  /** A dish on a mast, tilted back. Unmarked: a sensor has nothing that runs hot. */
  [WeaponType.Radar]: [
    seg(0, -3, 6, 0, -3, 10),
    seg(0, 3, 6, 0, 3, 10),
    seg(-6, -12, 8, -6, 12, 8),
    seg(-6, 12, 8, 8, 12, 16),
    seg(8, 12, 16, 8, -12, 16),
    seg(8, -12, 16, -6, -12, 8),
    seg(-6, 0, 8, 8, 0, 16),
    // The turntable the masts stand on, and the feed horn at the dish's focus.
    ...plate(12, 12, 0),
    ...box(8, 8, 1, 6, 0, 0),
    seg(1, 0, 12, 6, 0, 12),
    seg(6, 0, 12, 6, 0, 10),
  ],

  /**
   * Four thick aerials out to the module's edge — a cross, where `dew` is a ring.
   *
   * Nothing here is marked, and the spire least of all: a jammer never fires, so a
   * node on it would put a heat colour on the one module that has no heat to show.
   */
  [WeaponType.Ew]: [
    ...plate(10, 10, 0),
    seg(0, 0, 2, 13, 13, 13),
    seg(0, 0, 2, 13, -13, 13),
    seg(0, 0, 2, -13, 13, 13),
    seg(0, 0, 2, -13, -13, 13),
    seg(0, 0, 7, 0, 0, 17),
    // Generator block with its heat fins, and a dipole at the end of each beam.
    ...box(8, 8, 1, 7, 0, 0),
    seg(-4, -5, 3, 4, -5, 3),
    seg(-4, 5, 3, 4, 5, 3),
    seg(11, 13, 13, 15, 11, 13),
    seg(11, -13, 13, 15, -11, 13),
    seg(-11, 13, 13, -15, 11, 13),
    seg(-11, -13, 13, -15, -11, 13),
  ],

  /** The emitter coil: a raised ring on four struts, the brightest module in the set. */
  [WeaponType.Dew]: [
    ...plate(12, 12, 0),
    ...ring(11, 8, 8, NodeKind.Barrel),
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      return seg(0, 0, 1, Math.cos(a) * 11, Math.sin(a) * 11, 8);
    }),
    seg(0, 0, 1, 0, 0, 14, NodeKind.Barrel),
    // Capacitor bank under the coil, and the lens ring the core fires through.
    ...box(8, 10, 1, 5, 0, 0),
    ...ring(6, 12, 6, NodeKind.Barrel),
  ],

  /**
   * A sealed canister perforated by five launch cells, opening upward — the salvo
   * size is legible from the model, exactly as it is from the sprite. Not
   * directional: the drones leave straight up.
   */
  [WeaponType.Fpv]: [
    ...box(20, 18, 0, 11),
    ...[-7, -3.5, 0, 3.5, 7].map((y) => seg(-8, y, 11, 8, y, 11, NodeKind.Barrel)),
    ...plate(14, 14, 0),
    // Rim around the hatches, and the telemetry mast the swarm is flown on.
    seg(-10, -9, 11, 10, -9, 11),
    seg(-10, 9, 11, 10, 9, 11),
    seg(-10, -9, 11, -10, 9, 11),
    seg(10, -9, 11, 10, 9, 11),
    seg(-8, -7, 11, -8, -7, 17, NodeKind.Barrel),
    seg(-8, -7, 17, -5, -7, 17, NodeKind.Barrel),
  ],
};
