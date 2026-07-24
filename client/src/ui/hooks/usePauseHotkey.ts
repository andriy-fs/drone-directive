import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';

/** Space / P / Esc toggles pause while a match is running. */
export function usePauseHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Use physical keys (e.code) so a non-Latin keyboard layout still works.
      const isPauseKey = e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP';
      if (!isPauseKey) return;
      const { status, togglePause } = useGameStore.getState();
      if (status !== 'playing') return;
      e.preventDefault(); // stop Space from scrolling the page
      togglePause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
