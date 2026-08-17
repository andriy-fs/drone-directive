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
