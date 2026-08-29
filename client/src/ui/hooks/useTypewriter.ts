import { useEffect, useState } from 'react';

/** Per character, and the ceiling on a whole passage — a long one speeds up rather than drags. */
const CHAR_MS = 55;
const MAX_TYPE_MS = 2200;

/**
 * How many characters of a passage are visible, as it types itself out.
 *
 * Shared by the two places that read like something coming over a wire: the radio
 * feed over the scene, and the spec sheet under the model in the build dialog.
 * One hook rather than two, because the effect is the whole point of both — a
 * second copy would drift in its timing and stop looking like the same machine
 * talking.
 *
 * **`key` is what starts a passage over, not the text.** The radio deliberately
 * keys on a line's id: two identical calls in a row are two transmissions, and
 * the second one has to type again. Keyed on the text they would be one.
 *
 * **Driven by the clock, not by a tick count.** Reading elapsed time each frame
 * is what makes the rate mean something: counted ticks lose characters whenever
 * the main thread is busy, and this hook is used in exactly such a place — the
 * build dialog types a spec sheet beside a model that is redrawing as it turns,
 * where a `setInterval` typed at a third of its nominal speed. Time-based, a busy
 * frame costs a frame of smoothness and no characters at all.
 *
 * Returns the full length immediately when the viewer has asked for reduced
 * motion, so the words are simply *there*.
 */
export function useTypewriter(key: string | number | null, length: number): number {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Progress is tagged with the passage it belongs to, so a new one reads as zero
  // by simply not matching. That is also what keeps the effect free of a reset:
  // there is no state to clear when `key` changes, only state that stops applying.
  const [progress, setProgress] = useState<{ key: string | number | null; n: number }>({ key: null, n: 0 });

  useEffect(() => {
    if (reduced || key === null || length === 0) return;
    const perChar = Math.max(8, Math.min(CHAR_MS, MAX_TYPE_MS / length));
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const n = Math.min(length, Math.floor((now - start) / perChar));
      // The same object when nothing moved, so React bails out rather than
      // re-rendering the passage once per frame while it waits for the next
      // character.
      setProgress((p) => (p.key === key && p.n === n ? p : { key, n }));
      if (n < length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, length, reduced]);

  if (reduced) return length;
  return progress.key === key ? Math.min(progress.n, length) : 0;
}
