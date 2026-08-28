/**
 * Which shell the page is running in, and where the other one is downloaded.
 *
 * Both are facts about the environment rather than settings, so they are module
 * constants: neither can change during a session, and threading them through
 * props would only invite someone to make them configurable.
 */

/**
 * True when the page is running inside the Electron desktop shell, which marks
 * its user agent (see `andriy-fs/drone-directive-desktop`).
 *
 * The user agent is the whole detection on purpose: the shell deliberately
 * exposes **no** runtime API to the page — no preload, no `contextBridge`, no
 * injected global — so there is nothing else to ask.
 */
export const isDesktopApp = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

/**
 * Where the desktop build's installers live. Deliberately `/releases/latest` and
 * not a per-file URL: the assets carry the version in their names, so a direct
 * link would need a version this repository must not know.
 */
export const DESKTOP_RELEASES_URL = 'https://github.com/andriy-fs/drone-directive-desktop/releases/latest';

/**
 * The bridge the desktop shell *may* expose, and nothing more.
 *
 * Kept as a global declaration rather than an import because it is not this
 * app's API: it belongs to `andriy-fs/drone-directive-desktop`, and every member
 * is optional because the page cannot know which shell version is hosting it.
 */
declare global {
  interface Window {
    droneDirectiveShell?: { quit?: () => void };
  }
}

/**
 * Quits the desktop app. A no-op in a browser tab — the entry that calls it is
 * only rendered when {@link isDesktopApp}.
 *
 * Two paths, in this order and for one reason each. The shell's IPC is preferred
 * because on macOS closing the window does *not* end the app (the shell's
 * `window-all-closed` deliberately skips darwin), so only the main process can
 * actually quit. `window.close()` is the fallback for shells published before
 * that bridge existed: Chromium normally refuses it for a window a script did
 * not open, but Electron closes its `BrowserWindow` anyway.
 */
export function quitDesktopApp(): void {
  const quit = window.droneDirectiveShell?.quit;
  if (quit) quit();
  else window.close();
}
