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
