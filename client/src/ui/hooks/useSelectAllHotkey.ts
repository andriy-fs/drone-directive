import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GameStatus } from '../../store/enums';
import { selectAllOwnRobots } from '../../store/selection';
import { isTypingTarget } from '../../utils/isTypingTarget';

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
      if (useGameStore.getState().status !== GameStatus.Playing) return;
      e.preventDefault(); // don't select page text
      selectAllOwnRobots();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
