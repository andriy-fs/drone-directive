import type { ChassisType, WeaponType } from '@drone-directive/types/enums';
import type { Model } from './segment';
import { CHASSIS, type Chassis } from './chassis';
import { WEAPONS } from './weapons';

/** A machine taken apart the way it is built: a hull, and a module bolted to its deck. */
export interface RobotParts {
  hull: Model;
  /** The weapon module, already lifted to the deck — so it is drawn in the machine's own frame. */
  module: Model;
  /** Height (px) of the hardpoint, for anything that wants to rotate the module about it. */
  deck: number;
}

/** Lift a module from the flat `z = 0` it was authored at onto a chassis's deck. */
function onDeck(chassis: Chassis, weapon: Model): Model {
  return weapon.map((s) => ({ ...s, z0: s.z0 + chassis.deck, z1: s.z1 + chassis.deck }));
}

/** Chassis + module, composed once at module load — 3 × 8 tables of a few dozen segments. */
function compose(chassis: Chassis, weapon: Model): Model {
  return [...chassis.hull, ...onDeck(chassis, weapon)];
}

/**
 * Every robot the game can build, as a finished outline.
 *
 * Built up front rather than per frame: there are twenty-four of them, each a few
 * dozen segments, and the alternative is composing the same arrays again for every
 * machine in the frustum sixty times a second.
 */
export const ROBOT_MODELS: Record<ChassisType, Record<WeaponType, Model>> = Object.fromEntries(
  Object.entries(CHASSIS).map(([chassis, spec]) => [
    chassis,
    Object.fromEntries(Object.entries(WEAPONS).map(([weapon, model]) => [weapon, compose(spec, model)])),
  ]),
) as Record<ChassisType, Record<WeaponType, Model>>;

/**
 * The same machine, but with the hull and the module still told apart.
 *
 * **Kept alongside the composed table rather than replacing it**, because the two
 * answer different questions. A hull view drawing a hundred contours wants one array
 * and one pass; anything that means to point the two halves in different directions —
 * a turret tracking a target while the hull drives elsewhere, the way `BASE_BODY` and
 * `BASE_LAUNCHER` already do — needs them apart, and composing them per frame to
 * take them apart again would be silly.
 *
 * Note what this does *not* supply: a robot has no turret bearing in the simulation
 * (`WeaponComp` does not hold one), so anything turning the module has to decide for
 * itself where it is pointing.
 */
export function robotParts(chassis: ChassisType, weapon: WeaponType): RobotParts {
  const spec = CHASSIS[chassis];
  return { hull: spec.hull, module: onDeck(spec, WEAPONS[weapon]), deck: spec.deck };
}
