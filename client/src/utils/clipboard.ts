/**
 * Copies `text` to the clipboard, reporting whether it worked.
 *
 * The async Clipboard API is the path, but it only exists in a secure context —
 * and a room code is routinely shared from a plain-http LAN address (a second
 * machine hitting `http://192.168.x.x:5173`), where `navigator.clipboard` is
 * simply undefined. Hence the `execCommand` fallback: deprecated, but it is what
 * still works there, and a copy button that silently does nothing is worse.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission or a non-focused document — fall through and try again.
  }
  return legacyCopy(text);
}

/** Pre-Clipboard-API copy: select a detached textarea and let the browser cut it. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  // Off-screen but still focusable: `display: none` would make the selection fail.
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);
  try {
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
