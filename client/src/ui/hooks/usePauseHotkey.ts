import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { isTypingTarget } from '../../utils/isTypingTarget';

/** Space / P / Esc toggles pause while a match is running. */
export function usePauseHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A space typed into the chat panel is a space, not a pause.
      if (isTypingTarget(e.target)) return;
      // Use physical keys (e.code) so a non-Latin keyboard layout still works.
      const isPauseKey = e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyP';
      if (!isPauseKey) return;
      const { status, togglePause, online } = useGameStore.getState();
      if (status !== 'playing') return;
      // Online the key asks both simulations to stop, and the request rides on the
      // tick stream — so with the link down there is nothing to carry it.
      if (online.status === 'inMatch' && online.link !== 'ok') return;
      e.preventDefault(); // stop Space from scrolling the page
      togglePause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
