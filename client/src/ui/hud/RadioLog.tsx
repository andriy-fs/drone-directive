import { useEffect, useState } from 'react';
import { loadBank, tryGetBank } from '../../radio/bank';
import { formatLine, stamp } from '../../radio/format';
import type { PhraseBank } from '../../radio/types';
import { useGameStore } from '../../store/gameStore';
import { selectRadio } from '../../store/selectors';
import type { RadioLine } from '../../store/types';

/** Per character, and the ceiling on a whole line — a long report speeds up rather than drags. */
const CHAR_MS = 55;
const MAX_TYPE_MS = 2200;

/**
 * The radio feed: unit chatter over the game scene, top-right.
 *
 * Flavour, not information — everything it says is already on screen or in the
 * HUD. That is what licenses the whole design: no background plate, no clicks
 * taken, no scrollback, and lines that simply expire. If it were load-bearing it
 * would have to be a panel.
 *
 * Three things here are worth knowing before editing.
 *
 * **Text is resolved at render, not stored.** The store holds a phrase key and a
 * seed (see `RadioLine`), so a line already on screen re-renders in the new
 * language when the player switches mid-match instead of freezing in the old one.
 *
 * **The bank is loaded lazily and may not be here yet.** `tryGetBank` returns null
 * until the locale's chunk lands, and the feed renders nothing through that —
 * which is fine, because the director starts the load at match start.
 *
 * **Expiry lives here rather than in the store.** One interval for the whole feed
 * calls `pruneRadio`, which no-ops when nothing aged out. The alternative — a
 * timer per line — is six timers doing the work of one.
 */
export function RadioLog() {
  const lines = useGameStore(selectRadio);
  const locale = useGameStore((s) => s.locale);
  const pruneRadio = useGameStore((s) => s.pruneRadio);
  // Seeded from the cache so a re-mount mid-match draws on the first frame; the
  // effect below is what covers the first load and every later language switch.
  // A switch resolves from cache in a microtask, so no paint shows the old one.
  const [bank, setBank] = useState<PhraseBank | null>(() => tryGetBank(locale));

  useEffect(() => {
    let alive = true;
    void loadBank(locale).then((next) => {
      if (alive) setBank(next);
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  useEffect(() => {
    const timer = window.setInterval(() => pruneRadio(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, [pruneRadio]);

  const newest = lines.at(-1);
  const revealed = useTypewriter(newest?.id ?? 0, newest && bank ? lengthOf(bank, newest) : 0);

  if (!bank || lines.length === 0) return null;

  return (
    // `aria-live="off"`: a screen reader narrating every quip over a live match
    // would be unusable. The log stays in the accessibility tree to be read on
    // demand, and says nothing on its own.
    <div className="radio-log" role="log" aria-live="off">
      {lines.map((line) => {
        const { speaker, text } = formatLine(bank, line.key, line.seed, line.params);
        const isNewest = line.id === newest?.id;
        return (
          <p key={line.id} className={`radio-log__line${line.alert ? ' radio-log__line--alert' : ''}`}>
            <span className="radio-log__stamp">[{stamp(line.elapsedMs)}]</span>{' '}
            <span className="radio-log__speaker">{speaker}:</span> {isNewest ? text.slice(0, revealed) : text}
            {isNewest && (
              <span className="radio-log__cursor" aria-hidden="true">
                ▋
              </span>
            )}
          </p>
        );
      })}
    </div>
  );
}

/**
 * How many characters of the newest line are visible. Only the newest one types —
 * everything above it was finished before it arrived, and re-typing the whole feed
 * on every append would be a different (and much sillier) effect.
 *
 * Returns the full length immediately when the player has asked for reduced
 * motion, so the text is simply *there*.
 */
function useTypewriter(lineId: number, length: number): number {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Progress is tagged with the line it belongs to, so a new line resets it by
  // simply not matching — no state has to be written to start one over.
  const [progress, setProgress] = useState({ id: 0, n: 0 });

  useEffect(() => {
    if (reduced || lineId === 0 || length === 0) return;
    const step = Math.max(8, Math.min(CHAR_MS, MAX_TYPE_MS / length));
    const timer = window.setInterval(() => {
      // Returning the same object once the line is fully typed is what stops the
      // re-renders; the timer itself is cleaned up when the newest line changes.
      setProgress((p) =>
        p.id === lineId && p.n >= length ? p : { id: lineId, n: Math.min(p.id === lineId ? p.n + 1 : 1, length) },
      );
    }, step);
    return () => window.clearInterval(timer);
  }, [lineId, length, reduced]);

  if (reduced) return length;
  return progress.id === lineId ? Math.min(progress.n, length) : 0;
}

/** The rendered length of a line, so the typewriter knows where to stop. */
function lengthOf(bank: PhraseBank, line: RadioLine): number {
  return formatLine(bank, line.key, line.seed, line.params).text.length;
}
