import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GameStatus, OnlineLink } from '../../store/enums';
import { selectOnlineLink } from '../../store/selectors';
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
      const state = useGameStore.getState();
      if (state.status !== GameStatus.Playing) return;
      // Online the key asks both simulations to stop, and the request rides on the
      // tick stream — so with the link down there is nothing to carry it. Solo
      // there is no link, and the selector reads `ok`.
      if (selectOnlineLink(state) !== OnlineLink.Ok) return;
      e.preventDefault(); // stop Space from scrolling the page
      state.togglePause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
