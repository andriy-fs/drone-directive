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
 * The game's Discord. An invite link, not a channel URL: it is the only form
 * that works for someone who is not a member yet, which is everyone the title
 * screen is offering it to.
 *
 * This stays the rail entry's `href`, so middle-click, "copy link" and "open in
 * new tab" all behave — {@link openDiscord} only overrides the plain left click.
 */
export const DISCORD_INVITE_URL = 'https://discord.gg/dZbNjRHy';

/**
 * The same invite addressed to the installed client. Discord's own scheme takes
 * the invite code after a placeholder path segment, which is why the `-` is
 * there; it is not a typo.
 */
const DISCORD_APP_URL = 'discord://-/invite/dZbNjRHy';

/**
 * How long to wait for the OS to hand the click to the Discord client before
 * giving up and opening the web invite.
 *
 * Short on purpose, and not only for the person without the app: a browser only
 * lets a script open a tab for a second or so after the click that caused it, so
 * a longer wait would turn the fallback into a blocked popup.
 */
const DISCORD_APP_TIMEOUT_MS = 1000;

/**
 * Opens the invite in the Discord client if the machine has one, and in a new
 * browser tab if it doesn't.
 *
 * There is no way to *ask* whether a protocol handler exists, so this does the
 * only thing that works: point the page at `discord://`, then watch for the page
 * losing focus. A handled scheme raises the client over the browser, which fires
 * `blur`/`visibilitychange`; an unhandled one does nothing at all — the browser
 * silently drops the navigation and the page keeps running — and the timer above
 * falls back to the web invite.
 *
 * Two consequences worth knowing. A browser that asks "open Discord?" in a
 * tab-modal dialog (Firefox) doesn't blur the page, so someone who takes their
 * time answering it can end up with the web tab as well. And the desktop shell
 * is excluded outright: Electron doesn't dispatch unknown schemes to the OS, so
 * there the attempt could only ever fail and waste a second.
 */
export function openDiscord(): void {
  if (isDesktopApp) {
    window.open(DISCORD_INVITE_URL, '_blank', 'noopener');
    return;
  }

  let left = false;
  // `blur` also fires for an alt-tab of the player's own, which is fine: either
  // way they are no longer sitting in front of a menu waiting for a tab, and a
  // second click costs less than a tab nobody asked for.
  const onLeave = () => {
    left = true;
  };
  window.addEventListener('blur', onLeave);
  window.addEventListener('pagehide', onLeave);
  document.addEventListener('visibilitychange', onLeave);

  window.setTimeout(() => {
    window.removeEventListener('blur', onLeave);
    window.removeEventListener('pagehide', onLeave);
    document.removeEventListener('visibilitychange', onLeave);
    if (!left) window.open(DISCORD_INVITE_URL, '_blank', 'noopener');
  }, DISCORD_APP_TIMEOUT_MS);

  // Last, so the listeners above are already armed. Assigning an unhandled
  // scheme is a no-op in every current browser — the page is not unloaded.
  window.location.href = DISCORD_APP_URL;
}

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
