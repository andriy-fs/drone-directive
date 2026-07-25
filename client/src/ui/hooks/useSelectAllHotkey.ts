import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

/** Ctrl/Cmd + A selects all of the local side's robots while a match is running. */
export function useSelectAllHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Match the physical key (e.code), not e.key, so a non-Latin keyboard
      // layout (e.g. Cyrillic) still triggers Ctrl/Cmd+A instead of the browser
      // selecting all page text.
      if (!(e.ctrlKey || e.metaKey) || e.code !== 'KeyA') return;
      const { status, robots, selectRobots, localSide } = useGameStore.getState();
      if (status !== 'playing') return;
      e.preventDefault(); // don't select page text
      // Own units are `localSide`, never a hardcoded Owner.Player — the online
      // guest plays Owner.AI, and matching 'player' would select the opponent's army.
      selectRobots(robots.filter((r) => r.owner === localSide).map((r) => r.id));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
