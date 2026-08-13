/**
 * The second audio adapter, next to `GameApp.wireBus`. Selection is store-only
 * state — it never reaches the EventBus, because it is the player's view of the
 * match rather than something the simulation does — so the sound for it hangs
 * off a store subscription instead.
 */
import { ChassisType } from '@drone-directive/types/enums';
import { robots } from '../../engine/ecs/queries';
import type { EcsWorld } from '../../engine/ecs/world';
import { useGameStore } from '../../store/gameStore';
import { orderChassis, selectionSoundFor, type SelectionSnapshot } from './selectionSound';
import { sfx } from './sfx';

/**
 * A floor on how often a selection can speak, purely to bound click-mashing.
 * Kept well under `RobotView`'s double-click window so it never eats the
 * deliberate single-then-group pair a double click produces.
 */
const MIN_GAP_MS = 70;

/**
 * Play a sound whenever the selection changes. Takes the world rather than the
 * engine because the world outlives individual matches, so one subscription
 * covers the whole app.
 */
export function attachSelectionAudio(world: EcsWorld): () => void {
  let prev: SelectionSnapshot = { robotIds: [], baseId: null };
  let lastAt = -Infinity;

  return useGameStore.subscribe((s) => {
    const next: SelectionSnapshot = { robotIds: s.selectedRobotIds, baseId: s.selectedBaseId };
    const sound = selectionSoundFor(prev, next);
    prev = next;
    if (sound === 'none') return;

    const now = performance.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;

    if (sound === 'base') {
      sfx.baseSelected();
      return;
    }

    const mix = chassisIn(world, next.robotIds);
    // The fallback covers a selected id whose entity is already reaped — rare,
    // and a wrong-chassis blip beats a silent click.
    if (sound === 'single') sfx.robotSelected(mix[0] ?? ChassisType.Tracks);
    else sfx.groupSelected(mix, next.robotIds.length);
  });
}

/**
 * The distinct chassis among the selected robots. One pass over the robot query
 * against a Set of ids — `findById` is a linear scan, and calling it per id
 * would make a 50-robot marquee quadratic.
 */
function chassisIn(world: EcsWorld, ids: readonly string[]): ChassisType[] {
  const wanted = new Set(ids);
  const found: ChassisType[] = [];
  for (const e of robots(world)) {
    if (!wanted.has(e.id) || found.includes(e.chassis)) continue;
    found.push(e.chassis);
    if (found.length === 3) break; // there are only three chassis types
  }
  return orderChassis(found);
}
