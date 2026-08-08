import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { isTypingTarget } from '../../utils/isTypingTarget';

/**
 * Select every robot of the local side. Shared with the Command section's button,
 * which exists so a player who hasn't learned the shortcut yet isn't locked out
 * of the manoeuvre — both paths must stay the same action.
 *
 * Own units are `localSide`, never a hardcoded Owner.Player: the online guest
 * plays Owner.AI, and matching 'player' would select the opponent's army.
 */
export function selectAllOwnRobots(): void {
  const { status, robots, selectRobots, localSide } = useGameStore.getState();
  if (status !== 'playing') return;
  selectRobots(robots.filter((r) => r.owner === localSide).map((r) => r.id));
}

/** Ctrl/Cmd + A selects all of the local side's robots while a match is running. */
export function useSelectAllHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // In a text field Ctrl+A is "select this message", not "select the army".
      if (isTypingTarget(e.target)) return;
      // Match the physical key (e.code), not e.key, so a non-Latin keyboard
      // layout (e.g. Cyrillic) still triggers Ctrl/Cmd+A instead of the browser
      // selecting all page text.
      if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyA') return;
      if (useGameStore.getState().status !== 'playing') return;
      e.preventDefault(); // don't select page text
      selectAllOwnRobots();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
