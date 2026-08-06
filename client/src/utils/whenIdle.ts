/**
 * Runs `task` once the browser has a spare moment, or soon after either way.
 *
 * For work that has to happen but must not compete with the first paint —
 * fetching the menu sound cues while the title-screen backdrop is still coming
 * down, say. `requestIdleCallback` is capped with a `timeout` so a page that
 * never goes idle still gets there; where it is missing entirely (older Safari)
 * a `setTimeout` after the current frame is close enough for this purpose.
 */
export function whenIdle(task: () => void, timeoutMs = 2000): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => task(), { timeout: timeoutMs });
  else setTimeout(task, 0);
}
