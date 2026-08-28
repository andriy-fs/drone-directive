import { useCallback, useSyncExternalStore } from 'react';

/**
 * The page's fullscreen state, read from the DOM rather than mirrored in React
 * state.
 *
 * That distinction is the whole hook. Fullscreen can be entered and left without
 * this component ever hearing about the click: Escape leaves it (Chromium's own
 * behaviour, which a page cannot suppress without the privileged Keyboard Lock
 * API), and under the Electron shell F11 and the View menu toggle the *window's*
 * fullscreen — a window-manager state Chromium does not report as
 * `document.fullscreenElement` at all. A `useState` mirror would go stale on the
 * first of those and make the next click do the opposite of what the icon says;
 * `document.fullscreenElement` cannot.
 *
 * The shell's F11 therefore stays invisible here, and that is the honest answer:
 * the button reports what the *page* asked for, which is the only thing it can
 * undo.
 */
export type Fullscreen = {
  /** Whether the page is currently the fullscreen element. */
  active: boolean;
  /** False where the API is missing or the embedder forbids it — hide the control. */
  supported: boolean;
  toggle: () => void;
};

const subscribe = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};

const isActive = () => document.fullscreenElement !== null;

export function useFullscreen(): Fullscreen {
  // No server snapshot argument: this app never renders on a server, and the
  // third parameter exists only for that case.
  const active = useSyncExternalStore(subscribe, isActive);

  const toggle = useCallback(() => {
    // Both calls reject rather than throw — a shell built with
    // `fullscreenable: false`, or a gesture the browser did not accept. There is
    // nothing useful to tell the player, but an unhandled rejection would still
    // reach the console, so both are caught.
    if (isActive()) void document.exitFullscreen().catch(() => {});
    // The whole app, not the canvas: the HUD has to come with it.
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  return { active, supported: document.fullscreenEnabled, toggle };
}
