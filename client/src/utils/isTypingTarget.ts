/**
 * True when a keyboard event landed in something the player is typing into.
 *
 * Every game hotkey listens on `window` — that is what makes them work no matter
 * where the focus is — and every one of them calls `preventDefault()`. Without
 * this guard, typing a message in the chat panel would pause the match (Space, P,
 * Esc), select the whole army (Ctrl+A), recall control groups (the digits), fly
 * the drone (WASD) and fire its weapon (E), and swallow the keystrokes on the way.
 * So each listener bails out early on a typing target, rather than every input in
 * the app having to remember to stop propagation.
 *
 * It lives in `utils/` rather than under `ui/hooks/` because the drone-flight keys
 * are handled in the Pixi layer (`pixi/input/pointer.ts`), which must not import
 * from `ui/`.
 *
 * Duck-typed rather than `instanceof HTMLElement`: the check has to hold for an
 * element in an iframe or another realm, and it keeps the function testable
 * without a DOM.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
