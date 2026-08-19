/**
 * Re-encodes the music masters in `assets-src/` into the Ogg Vorbis files the
 * game streams from `public/music/`.
 *
 * Run by hand after a track is regenerated (`node scripts/encode-music.mjs`) and
 * commit the output — same deal as `encode-sprites.mjs` and `encode-favicon.mjs`:
 * a track changes about once a year and `ffmpeg` is not an npm dependency.
 * Requires `ffmpeg` on PATH.
 *
 * Two things here are the whole point:
 *
 * 1. **Vorbis, never MP3.** Both tracks loop, and MP3/AAC carry an encoder
 *    priming delay that turns the wrap into an audible gap. Vorbis is gapless, so
 *    the seam is only as good as the master — which is why the briefs in
 *    `.docs/sfx/` ask for no attack on sample 0 and no tail at the end.
 * 2. **`-q:a 3` (~112 kb/s), not the master's bitrate.** These are beds mixed two
 *    orders of magnitude below the cues; the menu track shipped at 256 kb/s for a
 *    while and bought nothing over the 192 kb/s MP3 it was transcoded from except
 *    a third of the deployed site's weight.
 *
 * The encoder does *not* set the mix level — that lives in `musicDefs` in
 * `src/config/sounds.ts`. After encoding, measure the result and reset it:
 *
 *     ffmpeg -i public/music/<name>.ogg -af ebur128 -f null -
 *
 * and pick `volume` so the bed lands near −27 LUFS (menu) or −30 LUFS (match,
 * which plays under every cue in the game). The script prints the integrated
 * loudness it measured so the arithmetic is in front of you.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../assets-src/', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/music/', import.meta.url));

/**
 * One row per track that has a master here. A row whose master is missing is
 * reported and skipped rather than fatal — same rule the sprite encoder uses for
 * art that has not been drawn yet.
 *
 * `terminal-standby`'s master shares its output's basename because it *is* the
 * output's ancestor: it arrived as a finished 205 kb/s `.ogg` with no earlier
 * source, shipped that way for a while, and was moved into `assets-src/` (out of
 * the build) so this script would have something to re-encode. Its row is
 * therefore the one lossy→lossy transcode here — acceptable at these bitrates for
 * a bed sitting ~27 dB down, and the alternative was shipping double the bytes of
 * every other track forever. Do not "clean up" the master as a duplicate: delete
 * it and the only 205 kb/s copy goes with it.
 */
const TRACKS = [
  // The in-match bed, generated from `.docs/sfx/main-soundtrack-prompt.md`.
  { name: 'standing-orders', src: 'game_music.mp3', quality: 3 },
  // The title-screen bed. See the note above about its master.
  { name: 'terminal-standby', src: 'terminal-standby.ogg', quality: 3 },
  // The two outcome stingers, generated from `.docs/sfx/outcome-stingers-prompt.md`.
  // They are calibrated 3 dB *above* the menu bed — nothing plays under them — so
  // the loudness this prints is measured against −24 LUFS, not −27/−30.
  //
  // **Shipped whole, at 1:15 and 1:48, against a brief that asked for 12–18 s.**
  // That length is deliberate and it is not what a trim would improve:
  //
  // - Both open the way a stinger has to. Victory puts a transient at −2.7 dBFS in
  //   its first 100 ms and a second hit at 0.7 s; defeat is at full level from
  //   sample 0. The modal appears on that frame, which is the requirement the
  //   brief's length figure was a proxy for.
  // - Both end in a composed decay to true silence — victory over its last 4 s,
  //   defeat over its last 8 — which is the half no fade-out can fake.
  // - Everything past ~20 s is tail. `music.playOnce` is cut short by a 600 ms fade
  //   the moment the player presses Play Again or Main menu, so the tail costs
  //   nothing but bytes, and cutting it would cost the ending above.
  //
  // Hence `quality: 2` rather than the beds' 3: ~1.9 MB for the pair instead of
  // 2.3, on dark pads mixed 24 dB down, where the difference is not audible. If a
  // regeneration ever comes back at the briefed length, put them back on 3.
  { name: 'victory-sting', src: 'victory-sting.mp3', quality: 2 },
  { name: 'defeat-sting', src: 'defeat-sting.mp3', quality: 2 },
];

const filters = process.argv.slice(2);
/** Whole-`-`-segment matching, so `standing` selects `standing-orders` and `orders` does too. */
const selected = TRACKS.filter(
  (t) => filters.length === 0 || filters.some((f) => t.name === f || t.name.split('-').includes(f)),
);

if (selected.length === 0) {
  console.error(`No track matches ${filters.join(', ')}. Known: ${TRACKS.map((t) => t.name).join(', ')}`);
  process.exitCode = 1;
}

/** Integrated loudness of a finished file, the number `musicDefs` is set against. */
function loudness(file) {
  // ebur128 reports on stderr, not stdout — hence `spawnSync` rather than the
  // `execFileSync` everything else here uses, which only hands back stdout.
  const run = spawnSync('ffmpeg', ['-v', 'info', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 16,
  });
  const report = run.stderr ?? '';
  const match = /I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/.exec(report.split('Integrated loudness').pop() ?? '');
  return match ? Number(match[1]) : null;
}

let before = 0;
let after = 0;
for (const track of selected) {
  const src = join(SRC_DIR, track.src);
  if (!existsSync(src)) {
    console.log(`${track.name.padEnd(22)} no master at assets-src/${track.src} — skipped`);
    continue;
  }
  const out = join(OUT_DIR, `${track.name}.ogg`);
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', src,
    '-c:a', 'libvorbis', '-q:a', String(track.quality), '-ar', '44100', '-ac', '2',
    out,
  ]);

  const from = statSync(src).size;
  const to = statSync(out).size;
  before += from;
  after += to;
  const lufs = loudness(out);
  console.log(
    `${track.name.padEnd(22)} q${track.quality}  ${kb(from)} → ${kb(to)}` +
      (lufs === null ? '' : `  (${lufs.toFixed(1)} LUFS integrated)`),
  );
}

if (after > 0) {
  console.log(`total                  ${kb(before)} → ${kb(after)}  (${Math.round((after / before) * 100)}%)`);
}

function kb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
