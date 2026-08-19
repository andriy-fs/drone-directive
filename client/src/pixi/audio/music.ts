/**
 * The game's music, kept apart from `sfx.ts` on purpose.
 *
 * A cue is fired and forgotten: `sfx.play` looks its buffer up, starts it, and
 * never sees it again. Music is the opposite — one instance per track, held for
 * as long as its screen is on, faded rather than cut. It also arrives late
 * (megabytes, not kilobytes), so it is fetched on its own instead of riding a
 * `SoundTier`.
 *
 * Two of the four tracks are looping beds (`menu`, `match`); the other two are
 * the outcome stingers, which play once and end themselves (`playOnce`, and the
 * `loop` flag in `musicDefs`). They are here rather than in `sfx.ts` because
 * everything above still applies to them — a handle, a fade, a lazy megabyte
 * fetch, and the music slider rather than the effects one.
 *
 * **Music owns its own gain, and this is load-bearing.** It used to ride
 * `sound.muteAll()` / `sound.volumeAll` from `sfx.ts`, which act on the shared
 * `WebAudioContext` every instance hangs off — one knob for everything. The
 * player wants two (music is switched off far more often than effects are), so
 * the context gain is left alone at 1 and unmuted: `sfx` scales each cue as it
 * plays it, and this module scales the instances below.
 *
 * The off switch is also the traffic saver: `play` returns *before* `load()`
 * when music is disabled, so a player who turned it off never fetches the
 * megabytes. Cues are not lazy in the same way — kilobytes, and rarely muted.
 *
 * Who drives it: `ui/screens/MainMenu` (mount/unmount) for the menu bed,
 * `GameApp`'s `sceneChanged` for the match bed — the one place both routes into a
 * match pass through, solo and online — and `GameApp`'s `gameOver` /
 * `sideEliminated` for the stingers. The tracks are independent slots, which is
 * what makes every handover a crossfade without any code for one: the old track
 * fades out while the new one comes in.
 */
import { Assets } from 'pixi.js';
import { sound, type IMediaInstance, type Sound } from '@pixi/sound';
import { musicDefs, type MusicName } from '../../config/sounds';
import { storage } from '../../utils/storage';
import { whenIdle } from '../../utils/whenIdle';

/** Long enough to read as the room coming up, short enough not to feel broken. */
const FADE_IN_MS = 1200;
/** Leaving is quicker than arriving: Start already has the player's attention. */
const FADE_OUT_MS = 600;
const FADE_STEP_MS = 25;

/** Persisted preferences, mirroring `sfx`'s `dd:sfxMuted` / `dd:sfxVolume`. */
const ENABLED_KEY = 'dd:musicEnabled';
const VOLUME_KEY = 'dd:musicVolume';
/** Music sits under the effects, which default to 1.0 — it is a bed, not an event. */
const DEFAULT_VOLUME = 0.6;

/** Which tracks their owner wants playing. Every async path re-checks this. */
const wanted = new Set<MusicName>();
/** The instance each track currently owns. One being faded out is not it. */
const instances = new Map<MusicName, IMediaInstance>();
/** Fetched once per page and reused, per track. */
const tracks = new Map<MusicName, Promise<Sound | null>>();
/** In-flight ramps, keyed by the instance they move — at most one each. */
const fades = new WeakMap<IMediaInstance, ReturnType<typeof setInterval>>();
/** A gesture listener is pending because the AudioContext is still suspended. */
let armed = false;
/**
 * Bumped every time a track starts. A one-shot's `complete` callback also fires
 * when the instance is `stop`ped, so a stinger cut short by *Play Again* runs its
 * release ~600 ms into the next match — by which point the slot may already be
 * somebody else's. Carrying the generation it was created with makes that late
 * callback a no-op instead of a slot it clears out from under a live instance.
 */
const generations = new Map<MusicName, number>();

let enabled = storage.getItem(ENABLED_KEY) !== 'off';
let userVolume = readVolume();

function readVolume(): number {
  const stored = storage.getItem(VOLUME_KEY);
  if (stored === null) return DEFAULT_VOLUME;
  const v = Number(stored);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : DEFAULT_VOLUME;
}

/** Where a track should sit right now: its calibration under the player's slider. */
function level(name: MusicName): number {
  return musicDefs[name].volume * userVolume;
}

/**
 * Fetched once per page and reused. Resolves to `null` on failure — a missing
 * file means a silent screen, never a broken one, exactly as a missing cue does.
 */
function load(name: MusicName): Promise<Sound | null> {
  let pending = tracks.get(name);
  if (!pending) {
    pending = Assets.load<Sound>(musicDefs[name].src).catch((err: unknown) => {
      console.error(`Failed to load the ${name} music; that screen stays silent`, err);
      return null;
    });
    tracks.set(name, pending);
  }
  return pending;
}

/**
 * Ramps one instance's volume to `to()` and runs `done` on arrival, replacing any
 * ramp already moving that same instance (a fade-out landing on something still
 * fading in — press Start inside the first second).
 *
 * The target is a *function* so that a slider moved mid-fade is honoured on the
 * next step rather than being overwritten when the ramp lands on a level the
 * player has since changed.
 *
 * `setInterval` rather than `requestAnimationFrame`: rAF stops in a hidden tab,
 * which would leave a fade-out parked half-way and the music playing quietly
 * under a match the player switched to another tab to start.
 */
function rampTo(target: IMediaInstance, to: () => number, ms: number, done?: () => void): void {
  const running = fades.get(target);
  if (running !== undefined) clearInterval(running);

  const from = target.volume;
  const started = performance.now();
  const timer = setInterval(() => {
    const t = Math.min((performance.now() - started) / ms, 1);
    target.volume = from + (to() - from) * t;
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
  for (const name of wanted) void start(name);
}

async function start(name: MusicName): Promise<void> {
  if (!enabled || !wanted.has(name) || instances.has(name)) return;

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

  const asset = await load(name);
  // The screen can be gone by now — the file is megabytes and the player may
  // have pressed Start while it was still coming down.
  if (!asset || !enabled || !wanted.has(name) || instances.has(name)) return;

  // A bed fades up from nothing; a stinger starts *at* level. Ramping one in over
  // 1.2 s would fade across its downbeat, which is the entire cue.
  const { loop } = musicDefs[name];
  const gen = (generations.get(name) ?? 0) + 1;
  generations.set(name, gen);
  // `Sound.play` is synchronous for a preloaded buffer and a promise otherwise;
  // the union is real, so both shapes have to be handled.
  const playing = asset.play({
    loop,
    volume: loop ? 0 : level(name),
    // One-shots let go of their own slot: without this the track would still be
    // `wanted` when the next match ended and the second win would play nothing.
    complete: loop ? undefined : () => release(name, gen),
  });
  const next = playing instanceof Promise ? await playing : playing;
  if (!enabled || !wanted.has(name)) {
    next.stop();
    return;
  }
  instances.set(name, next);
  if (loop) rampTo(next, () => level(name), FADE_IN_MS);
}

/**
 * A one-shot reached its end: drop it, without the fade `stop` would apply.
 * Ignored if a newer instance of the same track has started since (see
 * `generations`).
 */
function release(name: MusicName, gen: number): void {
  if (generations.get(name) !== gen) return;
  wanted.delete(name);
  instances.delete(name);
  if (wanted.size === 0) disarm();
}

/** Fades the instance a track owns out of existence, if it has one. */
function fadeOut(name: MusicName): void {
  // Detach *first* and fade the detached one — so a `play` arriving mid-fade
  // (menu → match → menu, or a remount) sees no current instance and starts a
  // fresh one over the top, rather than being turned away by a handle that is on
  // its way out.
  const leaving = instances.get(name);
  instances.delete(name);
  if (!leaving) return;
  rampTo(leaving, () => 0, FADE_OUT_MS, () => leaving.stop());
}

export const music = {
  /**
   * This track's screen is up. Idempotent: a second call while it is already
   * playing (or already waiting for a gesture) does nothing.
   *
   * The fetch is deferred to idle for the same reason the menu sound tier is —
   * the backdrop is the one asset the player is actually looking at, and this
   * file cannot be heard before a gesture anyway.
   */
  play(name: MusicName): void {
    if (wanted.has(name)) return;
    wanted.add(name);
    whenIdle(() => void start(name));
  },

  /**
   * Fire a one-shot track now — the outcome stingers, at the moment the game-over
   * modal goes up. Three things separate it from `play`:
   *
   * - **It ducks the match bed out.** The bed is a loop with no arc, written not
   *   knowing how the match ends; leaving it under the stinger would play two
   *   unrelated pieces at once. `stop` fades it over 600 ms, which is the same
   *   crossfade the menu→match handover already uses.
   * - **It does not wait for idle.** `play`'s deferral is right for a bed nobody
   *   is waiting on; here the picture is already on screen.
   * - **It is idempotent per outcome.** A free-for-all defeat is raised twice —
   *   `sideEliminated` and then `gameOver` — and must be heard once.
   */
  playOnce(name: MusicName): void {
    if (wanted.has(name)) return;
    music.stop('match');
    wanted.add(name);
    void start(name);
  },

  /**
   * Warm a track's file without playing it, so a stinger fired at game over is
   * already in memory rather than starting a download at the moment it is needed.
   * Memoized by `load`, so calling it every match start costs one fetch a page.
   *
   * Gated on `enabled` like everything else here: a player who turned music off
   * must not be made to fetch it anyway. That is the whole traffic-saving
   * property of this module and it is easy to lose from exactly this function.
   */
  prefetch(name: MusicName): void {
    if (enabled) void load(name);
  },

  /** This track's screen is leaving. */
  stop(name: MusicName): void {
    if (!wanted.delete(name)) return;
    if (wanted.size === 0) disarm();
    fadeOut(name);
  },

  isEnabled(): boolean {
    return enabled;
  },

  /**
   * The music switch. Off fades everything playing out and, more to the point,
   * stops any of it being fetched; on starts whatever screen is currently up —
   * which is also when the file is finally downloaded.
   */
  setEnabled(value: boolean): void {
    if (enabled === value) return;
    enabled = value;
    storage.setItem(ENABLED_KEY, value ? 'on' : 'off');
    if (value) {
      for (const name of wanted) void start(name);
    } else {
      disarm();
      for (const name of instances.keys()) fadeOut(name);
    }
  },

  getVolume(): number {
    return userVolume;
  },

  /** Music volume, 0..1, independent of the effects slider. Persisted. */
  setVolume(value: number): void {
    userVolume = Math.min(Math.max(value, 0), 1);
    storage.setItem(VOLUME_KEY, String(userVolume));
    // A fading instance picks the new level up on its next step (see `rampTo`);
    // one sitting at its target has to be told.
    for (const [name, playing] of instances) {
      if (!fades.has(playing)) playing.volume = level(name);
    }
  },
};
