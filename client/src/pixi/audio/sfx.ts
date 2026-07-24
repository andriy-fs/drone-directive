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
};
