/**
 * The game's sound. Cues are sample files (see `config/sounds.ts` for the table
 * and `.docs/sfx/README.md` for what each one is meant to be) played through
 * `@pixi/sound`, which owns the AudioContext and puts an analyser + compressor
 * in front of the destination — so there is no hand-built bus here any more.
 *
 * The AudioContext still starts suspended and must be resumed after a user
 * gesture (see `resume`, called from the Start button).
 */
import { sound, webaudio, type PlayOptions } from '@pixi/sound';
import { soundDefs, type SoundName } from '../../config/sounds';
import { storage } from '../../utils/storage';
import type { ChassisType } from '@drone-directive/types/enums';

/** Persisted preferences. `dd:` prefix + absence-means-default, as with `dd:chatSound`. */
const MUTED_KEY = 'dd:sfxMuted';
const VOLUME_KEY = 'dd:sfxVolume';

/**
 * Cues whose buffer is decoded and ready. `sound.exists()` is **not** a
 * substitute: it goes true the moment an alias is registered, and `Sound.play()`
 * in that state *queues* the call and fires it once decoding finishes — which
 * would spray a match's worth of stale explosions seconds after the fact.
 */
const ready = new Set<SoundName>();

/** Context time of the last pip/boom of each rate-limited cue. */
let lastUnitReadyAt = -Infinity;
let lastExplosionAt = -Infinity;

/** Selection cues layer a chassis voice under the group cue; see `groupSelected`. */
const GROUP_LAYER_DELAY_MS = 70;
/** Bursts of an identical buffer starting on the same sample sum coherently. */
const COALESCE_MS = 120;

const chassisCue: Record<ChassisType, SoundName> = {
  tracks: 'select-tracks',
  wheels: 'select-wheels',
  legs: 'select-legs',
};

function play(name: SoundName, options?: { speed?: number; volumeScale?: number }): void {
  if (!ready.has(name)) return;
  const def = soundDefs[name];
  const opts: PlayOptions = { volume: def.volume * (options?.volumeScale ?? 1) };
  // Set `speed` only when there is one to set: `Sound.play` spreads the caller's
  // options *over* its defaults, so a present-but-undefined key overwrites the
  // default of 1 and the playback rate ends up NaN.
  if (options?.speed !== undefined) opts.speed = options.speed;
  void sound.play(name, opts);
}

/** Called by the asset loader once a cue's buffer is decoded. */
export function markSoundReady(name: SoundName): void {
  ready.add(name);
}

/**
 * Apply the stored preferences and stop the library from suspending itself.
 *
 * `WebAudioContext.autoPause` defaults to true, which suspends the whole context
 * when the window loses focus. That would silence the chat notification — the
 * one cue whose entire job is to reach a player who is looking somewhere else.
 */
function init(): void {
  const ctx = sound.context;
  if (ctx instanceof webaudio.WebAudioContext) ctx.autoPause = false;

  const storedVolume = Number(storage.getItem(VOLUME_KEY));
  sound.volumeAll = Number.isFinite(storedVolume) && storage.getItem(VOLUME_KEY) !== null
    ? Math.min(Math.max(storedVolume, 0), 1)
    : 1;
  if (storage.getItem(MUTED_KEY) === 'on') sound.muteAll();
}

init();

export const sfx = {
  /** Resume the context after a user gesture (browsers block autoplay). */
  resume(): void {
    void sound.context.audioContext.resume();
  },

  setMuted(value: boolean): void {
    // Always go through muteAll/unmuteAll — assigning `sound.context.muted`
    // directly skips the library's `refresh()` and never reaches the graph.
    if (value) sound.muteAll();
    else sound.unmuteAll();
    storage.setItem(MUTED_KEY, value ? 'on' : 'off');
  },
  isMuted(): boolean {
    return sound.context.muted;
  },

  /** Master volume, 0..1. Persisted; the mute switch is independent of it. */
  setVolume(value: number): void {
    const v = Math.min(Math.max(value, 0), 1);
    sound.volumeAll = v;
    storage.setItem(VOLUME_KEY, String(v));
  },
  getVolume(): number {
    return sound.volumeAll;
  },

  cannonShot(): void {
    play('shot-cannon');
  },

  missileShot(): void {
    play('shot-missile');
  },

  /**
   * A reap can destroy a dozen entities inside one fixed step, and the bus
   * dispatches those synchronously: identical buffers starting on the same
   * sample sum coherently into one clipped bang. Coalesce the burst, and vary
   * the pitch of what survives so repeats don't sound like a loop.
   */
  explosion(): void {
    const now = performance.now();
    if (now - lastExplosionAt < COALESCE_MS) return;
    lastExplosionAt = now;
    play('explosion', { speed: 0.94 + Math.random() * 0.12 });
  },

  /**
   * A new chat message. Roughly a fifth of the volume of anything the game
   * itself makes: it has to be noticeable while the player is looking at the
   * battle and forgettable while they are not.
   */
  chatMessage(): void {
    play('chat-message');
  },

  /** The other half of that pair — a message of ours going out. */
  chatSend(): void {
    play('chat-send');
  },

  /** Selecting your base: the factory acknowledging an order. */
  baseSelected(): void {
    play('select-base');
  },

  /**
   * Selecting one robot, by chassis. The three differ on register, texture and
   * rhythm at once, so they stay apart under gunfire and not merely on a quiet
   * menu.
   */
  robotSelected(chassis: ChassisType): void {
    play(chassisCue[chassis]);
  },

  /**
   * Selecting a group: the column rolling out, with the heaviest chassis present
   * layered under it so a wheeled squad still sounds wheeled.
   *
   * The layer is delayed rather than played alongside: two `sound.play` calls in
   * one synchronous tick start inside the same render quantum — i.e. on the same
   * output sample — and sum coherently into a single loud transient instead of
   * arriving as a mix. Timer jitter is inaudible against a 70 ms offset.
   */
  groupSelected(chassis: readonly ChassisType[], count: number): void {
    // Varispeed drops the pitch and stretches the cue, which is what the
    // synthesized version did by hand for a big selection.
    play('select-group', { speed: count >= 8 ? 0.85 : 1 });
    const lead = chassis[0];
    if (lead) setTimeout(() => play(chassisCue[lead], { volumeScale: 0.5 }), GROUP_LAYER_DELAY_MS);
  },

  /**
   * A robot rolled off the line. Fires unattended for the whole match, so it has
   * to be a pip the player stops consciously hearing. Several bases can finish
   * on the same tick — same coherent-summing problem as `explosion`.
   */
  unitReady(): void {
    const now = performance.now();
    if (now - lastUnitReadyAt < COALESCE_MS) return;
    lastUnitReadyAt = now;
    play('unit-ready');
  },

  /** Any button in the HUD or the menus. */
  buttonClick(): void {
    play('button-click');
  },

  /** A modal coming up. */
  modalOpen(): void {
    play('modal-open');
  },
};
