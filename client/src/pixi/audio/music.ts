/**
 * The title screen's music, kept apart from `sfx.ts` on purpose.
 *
 * A cue is fired and forgotten: `sfx.play` looks its buffer up, starts it, and
 * never sees it again. Music is the opposite — one instance at a time, looping,
 * held for as long as the menu is on screen, faded rather than cut. It also
 * arrives late (megabytes, not kilobytes), so it is fetched on its own instead
 * of riding a `SoundTier`.
 *
 * Mute and master volume are **not** re-implemented here: `sound.muteAll()` and
 * `sound.volumeAll` in `sfx.ts` act on the shared `WebAudioContext`, which every
 * instance is downstream of — so the existing sound settings already govern this
 * without knowing it exists.
 *
 * Who drives it: `ui/screens/MainMenu`, mount and unmount. That is the same
 * "the interface plays its own sound" channel `ui/common/` uses for the button
 * click — the engine has no concept of a title screen, so there is no bus event
 * to hang this on, and `App` mounts the menu exactly when it should be heard.
 */
import { Assets } from 'pixi.js';
import { sound, type IMediaInstance, type Sound } from '@pixi/sound';
import { menuMusic } from '../../config/sounds';
import { whenIdle } from '../../utils/whenIdle';

/** Long enough to read as the room coming up, short enough not to feel broken. */
const FADE_IN_MS = 1200;
/** Leaving is quicker than arriving: Start already has the player's attention. */
const FADE_OUT_MS = 600;
const FADE_STEP_MS = 25;

/** The menu is on screen and wants music. Every async path re-checks this. */
let wanted = false;
let track: Promise<Sound | null> | null = null;
/** The instance the menu currently owns. An instance being faded out is not it. */
let instance: IMediaInstance | null = null;
/** In-flight ramps, keyed by the instance they move — at most one each. */
const fades = new WeakMap<IMediaInstance, ReturnType<typeof setInterval>>();
/** A gesture listener is pending because the AudioContext is still suspended. */
let armed = false;

/**
 * Fetched once per page and reused. Resolves to `null` on failure — a missing
 * file means a silent menu, never a broken one, exactly as a missing cue does.
 */
function load(): Promise<Sound | null> {
  track ??= Assets.load<Sound>(menuMusic.src).catch((err: unknown) => {
    console.error('Failed to load menu music; the title screen stays silent', err);
    return null;
  });
  return track;
}

/**
 * Ramps one instance's volume to `to` and runs `done` on arrival, replacing any
 * ramp already moving that same instance (a fade-out landing on something still
 * fading in — press Start inside the first second).
 *
 * `setInterval` rather than `requestAnimationFrame`: rAF stops in a hidden tab,
 * which would leave a fade-out parked half-way and the music playing quietly
 * under a match the player switched to another tab to start.
 */
function rampTo(target: IMediaInstance, to: number, ms: number, done?: () => void): void {
  const running = fades.get(target);
  if (running !== undefined) clearInterval(running);

  const from = target.volume;
  const started = performance.now();
  const timer = setInterval(() => {
    const t = Math.min((performance.now() - started) / ms, 1);
    target.volume = from + (to - from) * t;
    if (t < 1) return;
    clearInterval(timer);
    fades.delete(target);
    done?.();
  }, FADE_STEP_MS);
  fades.set(target, timer);
}

/**
 * Retry once the player touches something.
 *
 * Autoplay policy keeps the AudioContext suspended until a gesture, and on the
 * title screen the first gesture is usually a click on a difficulty chip rather
 * than on Start — so waiting for `sfx.resume()` at Start would mean the music
 * only ever began as the menu was leaving. Capture phase, so a handler that
 * stops propagation can't swallow it.
 */
function arm(): void {
  if (armed) return;
  armed = true;
  window.addEventListener('pointerdown', onGesture, { capture: true, once: true });
  window.addEventListener('keydown', onGesture, { capture: true, once: true });
}

function disarm(): void {
  if (!armed) return;
  armed = false;
  window.removeEventListener('pointerdown', onGesture, { capture: true });
  window.removeEventListener('keydown', onGesture, { capture: true });
}

function onGesture(): void {
  // Both listeners are `once`, so the one that fired is already gone; `disarm`
  // is here for its twin, which is not.
  disarm();
  void start();
}

async function start(): Promise<void> {
  if (!wanted || instance) return;

  const ctx = sound.context.audioContext;
  // Read through a call rather than inline: `resume()` mutates `state` behind
  // TypeScript's back, and a second inline `ctx.state !== 'running'` is narrowed
  // to a comparison it believes can never hold.
  const running = () => ctx.state === 'running';
  if (!running()) {
    // Rejects while the page is still ungestured; that is the expected path, not
    // an error, so the state check below is what actually decides.
    await ctx.resume().catch(() => {});
    if (!running()) {
      arm();
      return;
    }
  }

  const asset = await load();
  // The menu can be gone by now — the file is megabytes and the player may have
  // pressed Start while it was still coming down.
  if (!asset || !wanted || instance) return;

  // `Sound.play` is synchronous for a preloaded buffer and a promise otherwise;
  // the union is real, so both shapes have to be handled.
  const playing = asset.play({ loop: true, volume: 0 });
  const next = playing instanceof Promise ? await playing : playing;
  if (!wanted) {
    next.stop();
    return;
  }
  instance = next;
  rampTo(next, menuMusic.volume, FADE_IN_MS);
}

export const music = {
  /**
   * The title screen is up. Idempotent: a second call while it is already
   * playing (or already waiting for a gesture) does nothing.
   *
   * The fetch is deferred to idle for the same reason the menu sound tier is —
   * the backdrop is the one asset the player is actually looking at, and this
   * file cannot be heard before a gesture anyway.
   */
  startMenu(): void {
    if (wanted) return;
    wanted = true;
    whenIdle(() => void start());
  },

  /**
   * The title screen is leaving. Detaches the instance *first* and fades the
   * detached one — so a `startMenu` arriving mid-fade (menu → match → menu, or
   * a remount) sees no current instance and starts a fresh one over the top,
   * rather than being turned away by a handle that is on its way out.
   */
  stopMenu(): void {
    if (!wanted) return;
    wanted = false;
    disarm();
    const leaving = instance;
    instance = null;
    if (!leaving) return;
    rampTo(leaving, 0, FADE_OUT_MS, () => leaving.stop());
  },
};
