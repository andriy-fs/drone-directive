import { WeaponType } from '@drone-directive/types/enums';
import { NodeKind, type Model } from './segment';
import { plate, ring, seg, tube, box } from './primitives';

/**
 * Every weapon module, exhaustively, authored flat at `z = 0` and lifted onto a
 * chassis's deck by `robots.ts`.
 *
 * Each one is the *dominant form* its sprite brief names and nothing else: the
 * cannon is one long barrel, the launcher is two fat tubes with open mouths, the
 * jammer is an X of four aerials, the emitter is a ring, the carrier is a
 * perforated canister. At 30 px the art has room for three or four shapes; a
 * wireframe at range has room for fewer, so each model keeps only the first.
 */
export const WEAPONS: Record<WeaponType, Model> = {
  // An empty hardpoint is a real state, not a missing entry.
  [WeaponType.None]: [],

  /** One thick barrel down the long axis, on a breech block. The baseline gun. */
  [WeaponType.Cannon]: [...plate(14, 14, 0), ...box(22, 5, 3, 8, 11, 0, NodeKind.Barrel)],

  /** Two fat tubes with dark mouths — heavier than the cannon, and it has to look it. */
  [WeaponType.Missiles]: [
    ...plate(14, 16, 0),
    ...tube(20, 6, 2, 9, 8, -5, NodeKind.Barrel),
    ...tube(20, 6, 2, 9, 8, 5, NodeKind.Barrel),
  ],

  /** The payload disc under its hazard cross. No barrel: this one *is* the round. */
  [WeaponType.Bomb]: [
    ...ring(13, 4, 8, NodeKind.Barrel),
    seg(-9, -9, 4, 9, 9, 4, NodeKind.Barrel),
    seg(-9, 9, 4, 9, -9, 4, NodeKind.Barrel),
    seg(0, 0, 4, 0, 0, 10, NodeKind.Barrel),
  ],

  /** A dish on a mast, tilted back. Unmarked: a sensor has nothing that runs hot. */
  [WeaponType.Radar]: [
    seg(0, 0, 0, 0, 0, 7),
    seg(-6, -12, 8, -6, 12, 8),
    seg(-6, 12, 8, 8, 12, 16),
    seg(8, 12, 16, 8, -12, 16),
    seg(8, -12, 16, -6, -12, 8),
    seg(-6, 0, 8, 8, 0, 16),
  ],

  /** Four thick aerials out to the module's edge — a cross, where `dew` is a ring. */
  [WeaponType.Ew]: [
    ...plate(8, 8, 0),
    seg(0, 0, 2, 13, 13, 13),
    seg(0, 0, 2, 13, -13, 13),
    seg(0, 0, 2, -13, 13, 13),
    seg(0, 0, 2, -13, -13, 13),
    seg(0, 0, 2, 0, 0, 15),
  ],

  /** The emitter coil: a raised ring on four struts, the brightest module in the set. */
  [WeaponType.Dew]: [
    ...plate(10, 10, 0),
    ...ring(11, 11, 8, NodeKind.Barrel),
    ...[0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      return seg(0, 0, 1, Math.cos(a) * 11, Math.sin(a) * 11, 11);
    }),
    seg(0, 0, 4, 0, 0, 11, NodeKind.Barrel),
  ],

  /**
   * A sealed canister perforated by five launch cells, opening upward — the salvo
   * size is legible from the model, exactly as it is from the sprite. Not
   * directional: the drones leave straight up.
   */
  [WeaponType.Fpv]: [
    ...box(20, 18, 0, 11),
    ...[-7, -3.5, 0, 3.5, 7].map((y) => seg(-7, y, 11, 7, y, 11, NodeKind.Barrel)),
  ],
};
