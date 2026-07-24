import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';

/** Physical digit keys 1-9, in order, mapped to their group number. */
const DIGIT_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] as const;

/**
 * Classic RTS control groups: Ctrl/Cmd + 1-9 saves the current selection under
 * that number; pressing the bare digit later reselects it (handy for jumping
 * straight to an attack squad). Groups are kept in a ref, not the store — this
 * is a UI-input convenience, not render state — and are pruned of any robot
 * that's no longer alive at recall time.
 */
export function useControlGroupHotkeys(): void {
  const groups = useRef(new Map<number, string[]>());

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const index = DIGIT_CODES.indexOf(e.code as (typeof DIGIT_CODES)[number]);
      if (index === -1) return;
      const { status, robots, selectedRobotIds, selectRobots } = useGameStore.getState();
      if (status !== 'playing') return;
      const groupNumber = index + 1;

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        groups.current.set(groupNumber, [...selectedRobotIds]);
        return;
      }
      if (e.altKey || e.shiftKey) return; // leave other digit-key combos alone

      const saved = groups.current.get(groupNumber);
      if (!saved) return;
      e.preventDefault();
      const aliveIds = new Set(robots.map((r) => r.id));
      selectRobots(saved.filter((id) => aliveIds.has(id)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
