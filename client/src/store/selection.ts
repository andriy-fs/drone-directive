import type { Owner, WeaponType } from '@drone-directive/types/enums';
import { useGameStore } from './gameStore';
import { GameStatus } from './enums';
import type { RobotSnapshot } from './types';

/**
 * The selection manoeuvres, as plain functions over the store.
 *
 * They live here rather than beside a button because three layers reach for the
 * same ones and none of them may reach the others: the HUD's selection dialog and
 * the Ctrl+A hotkey (React), and a double-click on a robot (`pixi/render/RobotView`),
 * which cannot import anything from `ui/` at all. The store is the one floor all
 * three already stand on.
 *
 * **Own units are `localSide`, never a hardcoded `Owner.Player`:** the online guest
 * plays `Owner.AI`, and matching 'player' would select the opponent's army.
 */

/** Every robot the local side has. */
export function selectAllOwnRobots(): void {
  const { status, robots, selectRobots, localSide } = useGameStore.getState();
  if (status !== GameStatus.Playing) return;
  selectRobots(robots.filter((r) => r.owner === localSide).map((r) => r.id));
}

/**
 * Every robot the local side has that carries `weapon` — the "all my cannons"
 * manoeuvre, offered by the selection dialog and by a double-click on one of them.
 */
export function selectOwnRobotsByWeapon(weapon: WeaponType): void {
  const { status, robots, selectRobots, localSide } = useGameStore.getState();
  if (status !== GameStatus.Playing) return;
  selectRobots(robots.filter((r) => r.owner === localSide && r.weapon === weapon).map((r) => r.id));
}

/**
 * How many of each weapon a side is fielding — what the selection dialog builds
 * its per-weapon buttons out of, so it only ever offers a manoeuvre that would
 * select something.
 *
 * Takes the snapshot rather than reading the store, so a component can compute it
 * from the `robots` it is already subscribed to and re-render as units are built
 * and lost.
 */
export function ownWeaponCounts(robots: RobotSnapshot[], side: Owner): Map<WeaponType, number> {
  const counts = new Map<WeaponType, number>();
  for (const r of robots) {
    if (r.owner !== side) continue;
    counts.set(r.weapon, (counts.get(r.weapon) ?? 0) + 1);
  }
  return counts;
}
