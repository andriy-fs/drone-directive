/**
 * The sound table: one entry per cue, mirroring `sprites.ts`. Each `src` points
 * straight at a file in `client/public/sounds/` — the three CC0 Kenney packs, as
 * downloaded — so a cue is a *reference* into that library rather than a copy of
 * it. What each cue is meant to be is written down in `.docs/sfx/README.md`.
 *
 * The upshot: `public/sounds/` is load-bearing. Renaming or pruning anything in
 * it breaks whichever cue points at it, and the game runs silent for that cue.
 *
 * Each entry also carries a `tier` saying *when* its file is fetched — the table
 * is the only place that decides, and `pixi/assets.ts` just reads it. See
 * `SoundTier` below.
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
  | 'shot-fpv'
  | 'explosion'
  | 'chat-message'
  | 'chat-send'
  | 'select-base'
  | 'select-tracks'
  | 'select-wheels'
  | 'select-legs'
  | 'select-group'
  | 'unit-ready'
  | 'shield-up'
  | 'shield-break'
  | 'shield-down'
  | 'button-click';

/**
 * When a cue's file is worth fetching.
 *
 * `menu` is everything that can sound before a match exists, and the list is
 * shorter than it looks: the AudioContext starts suspended, so nothing plays at
 * all until the first pointer press unlocks it. Chat is in here because
 * `<ChatPanel/>` mounts unconditionally and `restoreChat` re-attaches to a
 * week-old conversation on load — a message can land while the player is still
 * reading the title screen.
 *
 * `match` is the rest, fetched when a match starts. Unlike a sprite (whose
 * absence is memoized into a permanent Graphics placeholder), a cue that has not
 * decoded yet is simply skipped by `play()` on that call and works on the next
 * one — so this tier is *started* at match start and never waited for.
 */
export type SoundTier = 'menu' | 'match';

export interface SoundDef {
  /** `null` = no file yet; the cue is silently skipped and the build stays green. */
  src: string | null;
  /**
   * Relative place in the mix, 0..1. Every file is peak-normalized to about
   * −1 dBFS, so these numbers *are* the balance — they reproduce the gains the
   * synthesized version used (its explosion, at 0.18, is the 1.0 reference here).
   */
  volume: number;
  /** Which load wave fetches this cue. See `SoundTier`. */
  tier: SoundTier;
}

/** Where in `public/sounds/` a cue's file lives. */
const src = (file: string) => `${PUBLIC_BASE}sounds/${file}.ogg`;

/**
 * The title screen's music bed — deliberately *not* a `SoundName`.
 *
 * Every cue above is a one-shot fired and forgotten; this one loops, needs a
 * handle to fade and stop, and is two orders of magnitude larger than any of
 * them, so it gets its own player (`pixi/audio/music.ts`) and its own lazy
 * fetch instead of a tier. It lives in `public/music/`, not `public/sounds/` —
 * that directory is the Kenney packs as downloaded, and this is not one.
 *
 * `volume` is the one number to turn. The track masters at −12.9 LUFS with peaks
 * at 0 dBFS (the cues are short transients peaking at −1), so at 1.0 it would
 * bury every one of them; 0.25 puts the bed around −27 LUFS, which reads as
 * background under a `button-click` at 0.15.
 */
export const menuMusic = {
  src: `${PUBLIC_BASE}music/terminal-standby.ogg`,
  volume: 0.25,
} as const;

export const soundDefs: Record<SoundName, SoundDef> = {
  explosion: { src: src('sci-fi/explosionCrunch_000'), volume: 1.0, tier: 'match' },
  'shot-missile': { src: src('sci-fi/laserLarge_000'), volume: 0.5, tier: 'match' },
  // Out of line with the rest on purpose: this source peaks 4.8 dB below the
  // others (−5.7 vs −1 dBFS), so 0.22 / 0.58 ≈ 0.38. Swap the file → reset to 0.22.
  'shot-cannon': { src: src('sci-fi/laserSmall_000'), volume: 0.38, tier: 'match' },
  // Directed energy: a rising electrical whine rather than a report, so a
  // knock-out shot is audibly not a kill even off-screen.
  'shot-dew': { src: src('digital/phaserUp3'), volume: 0.35, tier: 'match' },
  // A salvo of FPV drones: a clattering rattle of several small motors leaving at
  // once, deliberately outside the laser/phaser family the three guns above share
  // — this is not a shot, it is five machines taking off. Peaks at −0.8 dBFS, in
  // line with the pack, so no compensation like `shot-cannon` needs.
  'shot-fpv': { src: src('digital/spaceTrash2'), volume: 0.4, tier: 'match' },
  // The energy dome's three moments. `shield-break` deliberately does *not* share
  // a family with the other two: raising and powering down are both a force
  // field, so they may sound related, but being beaten down must not be mistaken
  // for the timer running out — that is the one distinction the player has to
  // make by ear. It is also the loudest of the three; a shatter is the bigger
  // event. Loud enough to carry, quiet enough that a dome is not the loudest
  // thing in a fight.
  'shield-up': { src: src('sci-fi/forceField_000'), volume: 0.5, tier: 'match' },
  'shield-break': { src: src('sci-fi/lowFrequency_explosion_001'), volume: 0.7, tier: 'match' },
  'shield-down': { src: src('sci-fi/forceField_002'), volume: 0.35, tier: 'match' },
  'select-base': { src: src('sci-fi/doorOpen_001'), volume: 0.42, tier: 'match' },
  'select-tracks': { src: src('sci-fi/impactMetal_003'), volume: 0.4, tier: 'match' },
  'select-wheels': { src: src('digital/phaserUp5'), volume: 0.4, tier: 'match' },
  'select-legs': { src: src('interface/switch_003'), volume: 0.4, tier: 'match' },
  'select-group': { src: src('digital/lowThreeTone'), volume: 0.3, tier: 'match' },
  'chat-message': { src: src('interface/glass_001'), volume: 0.19, tier: 'menu' },
  'unit-ready': { src: src('interface/confirmation_001'), volume: 0.17, tier: 'match' },
  'button-click': { src: src('interface/click_001'), volume: 0.15, tier: 'menu' },
  'chat-send': { src: src('interface/pluck_001'), volume: 0.13, tier: 'menu' },
};

/** The cues in one tier that actually have a file, for the loader to fetch. */
export function soundSources(tier: SoundTier): { name: SoundName; src: string }[] {
  const out: { name: SoundName; src: string }[] = [];
  for (const [name, def] of Object.entries(soundDefs) as [SoundName, SoundDef][]) {
    if (def.src && def.tier === tier) out.push({ name, src: def.src });
  }
  return out;
}
