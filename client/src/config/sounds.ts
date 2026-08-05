/**
 * The sound table: one entry per cue, mirroring `sprites.ts`. Each `src` points
 * straight at a file in `client/public/sounds/` — the three CC0 Kenney packs, as
 * downloaded — so a cue is a *reference* into that library rather than a copy of
 * it. What each cue is meant to be is written down in `.docs/sfx/README.md`.
 *
 * The upshot: `public/sounds/` is load-bearing. Renaming or pruning anything in
 * it breaks whichever cue points at it, and the game runs silent for that cue.
 *
 * Deliberately free of any `@pixi/sound` import: `config/` is reachable from the
 * React layer, and pulling the audio engine into that graph is exactly what
 * `sprites.ts` avoids by importing no Pixi. The player lives in `pixi/audio/`.
 */
const PUBLIC_BASE = import.meta.env.BASE_URL;

export type SoundName =
  | 'shot-cannon'
  | 'shot-missile'
  | 'shot-dew'
  | 'explosion'
  | 'chat-message'
  | 'chat-send'
  | 'select-base'
  | 'select-tracks'
  | 'select-wheels'
  | 'select-legs'
  | 'select-group'
  | 'unit-ready'
  | 'button-click'
  | 'modal-open';

export interface SoundDef {
  /** `null` = no file yet; the cue is silently skipped and the build stays green. */
  src: string | null;
  /**
   * Relative place in the mix, 0..1. Every file is peak-normalized to about
   * −1 dBFS, so these numbers *are* the balance — they reproduce the gains the
   * synthesized version used (its explosion, at 0.18, is the 1.0 reference here).
   */
  volume: number;
}

/** Where in `public/sounds/` a cue's file lives. */
const src = (file: string) => `${PUBLIC_BASE}sounds/${file}.ogg`;

export const soundDefs: Record<SoundName, SoundDef> = {
  explosion: { src: src('sci-fi/explosionCrunch_000'), volume: 1.0 },
  'shot-missile': { src: src('sci-fi/laserLarge_000'), volume: 0.5 },
  // Out of line with the rest on purpose: this source peaks 4.8 dB below the
  // others (−5.7 vs −1 dBFS), so 0.22 / 0.58 ≈ 0.38. Swap the file → reset to 0.22.
  'shot-cannon': { src: src('sci-fi/laserSmall_000'), volume: 0.38 },
  // Directed energy: a rising electrical whine rather than a report, so a
  // knock-out shot is audibly not a kill even off-screen.
  'shot-dew': { src: src('digital/phaserUp3'), volume: 0.35 },
  'select-base': { src: src('sci-fi/doorOpen_001'), volume: 0.42 },
  'select-tracks': { src: src('sci-fi/impactMetal_003'), volume: 0.4 },
  'select-wheels': { src: src('digital/phaserUp5'), volume: 0.4 },
  'select-legs': { src: src('interface/switch_003'), volume: 0.4 },
  'select-group': { src: src('digital/lowThreeTone'), volume: 0.3 },
  'modal-open': { src: src('interface/open_002'), volume: 0.25 },
  'chat-message': { src: src('interface/glass_001'), volume: 0.19 },
  'unit-ready': { src: src('interface/confirmation_001'), volume: 0.17 },
  'button-click': { src: src('interface/click_001'), volume: 0.15 },
  'chat-send': { src: src('interface/pluck_001'), volume: 0.13 },
};

/** The cues that actually have a file, for the loader to fetch. */
export function soundSources(): { name: SoundName; src: string }[] {
  const out: { name: SoundName; src: string }[] = [];
  for (const [name, def] of Object.entries(soundDefs) as [SoundName, SoundDef][]) {
    if (def.src) out.push({ name, src: def.src });
  }
  return out;
}
