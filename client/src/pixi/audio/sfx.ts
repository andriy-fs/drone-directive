/**
 * Tiny self-contained sound layer using the Web Audio API — no external assets
 * or dependencies. Sounds are synthesized on the fly (a blip for shots, a noise
 * burst for explosions). The AudioContext is created lazily and must be resumed
 * after a user gesture (see `resume`, called from the Start button).
 */
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let ctx: AudioContext | null = null;
let muted = false;

function audioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : (window as AudioWindow).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

function blip(freq: number, duration: number, type: OscillatorType, gain: number): void {
  const a = audioCtx();
  if (!a || muted) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
  osc.connect(g).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + duration);
}

/** Like `blip`, but the oscillator's pitch sweeps from `freq` to `endFreq` over `duration`. */
function sweep(freq: number, endFreq: number, duration: number, type: OscillatorType, gain: number): void {
  const a = audioCtx();
  if (!a || muted) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(endFreq, a.currentTime + duration);
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + duration);
  osc.connect(g).connect(a.destination);
  osc.start();
  osc.stop(a.currentTime + duration);
}

/**
 * A soft sine note, scheduled `delay` seconds out. Unlike `blip` the gain ramps
 * *up* rather than starting at full: an instant attack on a pure sine is audible
 * as a click, which is the opposite of what a notification should sound like.
 */
function chime(freq: number, delay: number, duration: number, gain: number): void {
  const a = audioCtx();
  if (!a || muted) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Exponential ramps cannot reach or leave zero, hence the near-silent endpoints.
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration);
}

function noiseBurst(duration: number, gain: number): void {
  const a = audioCtx();
  if (!a || muted) return;
  const frames = Math.floor(a.sampleRate * duration);
  const buffer = a.createBuffer(1, frames, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames); // white noise, decaying
  }
  const src = a.createBufferSource();
  src.buffer = buffer;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(g).connect(a.destination);
  src.start();
}

export const sfx = {
  /** Resume the context after a user gesture (browsers block autoplay). */
  resume(): void {
    void audioCtx()?.resume();
  },
  setMuted(value: boolean): void {
    muted = value;
  },
  isMuted(): boolean {
    return muted;
  },
  cannonShot(): void {
    blip(760, 0.06, 'square', 0.04);
  },
  /** Louder, longer launch: a descending thump sweep layered under a short whoosh. */
  missileShot(): void {
    sweep(320, 90, 0.18, 'sawtooth', 0.09);
    noiseBurst(0.16, 0.05);
  },
  explosion(): void {
    noiseBurst(0.3, 0.18);
  },
  /**
   * A new chat message: two soft rising sine notes, at roughly a fifth of the
   * volume of anything the game itself makes. It has to be noticeable while the
   * player is looking at the battle and forgettable while they are not — a
   * weapon-grade blip would just train them to switch it off.
   */
  chatMessage(): void {
    chime(784, 0, 0.1, 0.035);
    chime(1046.5, 0.07, 0.14, 0.03);
  },
};
