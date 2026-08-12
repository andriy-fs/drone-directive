/**
 * Re-encodes the sprite masters in `assets-src/sprites/` into the WebP files the
 * game actually ships from `public/`.
 *
 * Run by hand after the art changes (`node scripts/encode-sprites.mjs`) and
 * commit the output. Deliberately **not** wired into `npm run build`: the inputs
 * change a few times a year, the tools are not npm dependencies, and a build that
 * shells out to ffmpeg on every CI run buys nothing.
 *
 * Two things here are not obvious and both are about correctness, not size:
 *
 * 1. **Premultiply before scaling.** Transparent pixels in the masters are
 *    RGBA(0,0,0,0) — black. Scaling non-premultiplied RGBA averages that black
 *    into the edge pixels, and Pixi (which uploads premultiplied) then darkens
 *    them a second time, so the sprite gets a dark fringe. Premultiplying first
 *    and undoing it after keeps the edge colour the artist drew.
 * 2. **Wrap-pad the seamless tiles.** A tile that wraps must still wrap after
 *    downscaling, so it is laid out 3×3, scaled, and the middle cut back out —
 *    the resampler then sees the neighbouring tile where it would otherwise clamp
 *    against the edge.
 *
 * Requires `ffmpeg` (scaling) and `cwebp` (encoding) on PATH. ffmpeg could encode
 * WebP on its own, but cwebp is where the alpha-quality and effort knobs live.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../assets-src/sprites/', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * `size` is the encoded square in px, chosen as roughly 2–3× the on-field size in
 * `config/sprites.ts` (the ceiling is `targetSize × devicePixelRatio`; the camera
 * has no zoom). The views scale whatever they get — `target / texture.width` —
 * so changing a number here needs no code change.
 *
 * `alpha: false` marks the opaque terrain art, which skips the premultiply dance;
 * `seamless: true` marks the tiles whose edges have to keep matching.
 */
const SPRITES = [
  // Robots — on-field 46 px (ROBOT_TARGET).
  ...['tracks', 'wheels', 'legs'].flatMap((chassis) =>
    ['player', 'ai'].map((side) => ({ name: `robot-${chassis}-${side}`, size: 128, quality: 90 })),
  ),
  // Bases — on-field 96 px (BASE_TARGET), already the smallest sensible master.
  ...['player', 'ai'].map((side) => ({ name: `base-${side}`, size: 256, quality: 90 })),
  // Weapon modules — on-field 24 px (WEAPON_TARGET), the biggest overshoot in the set.
  ...['bomb', 'cannon', 'dew', 'ew', 'fpv', 'missiles', 'radar'].flatMap((weapon) =>
    ['player', 'ai'].map((side) => ({ name: `weapon-${weapon}-${side}`, size: 64, quality: 90 })),
  ),
  // Observer drone — on-field 40 px (DRONE_TARGET).
  { name: 'drone-player', size: 128, quality: 90 },
  // FPV strike drone — on-field 30 px (MUNITION_TARGET); one art set for every
  // side, tinted per owner, so there is no `-player`/`-ai` pair here.
  { name: 'fpv-munition', size: 96, quality: 90 },
  // Terrain: opaque, tiled, and already at or near its display size.
  { name: 'obstacle-crater', size: 64, quality: 90, alpha: false, seamless: true },
  { name: 'obstacle-mountain', size: 64, quality: 90, alpha: false, seamless: true },
  // Ground: repeats every 128 px of field (tilePx × GROUND_REPEAT_TILES), so 512
  // still leaves 4× headroom — and it is the flattest, least detailed art here.
  { name: 'ground-tile', size: 512, quality: 82, alpha: false, seamless: true },
];

/** The ffmpeg filter chain that turns a master into a correctly scaled RGBA/RGB frame. */
function filterChain({ size, alpha = true, seamless = false }) {
  const steps = [];
  // 3×3 first, so the scaler reads across the wrap instead of clamping at the edge.
  if (seamless) steps.push('loop=loop=8:size=1:start=0', 'tile=3x3');
  if (alpha) steps.push('format=rgba');
  // Square the frame with transparent padding before scaling. Every output here
  // is a square, and `scale` on its own would *stretch* a master that isn't one
  // — a generator that hands back 1536×1024 instead of the 512×512 the prompts
  // ask for would silently ship a squashed unit. A no-op for a square master, so
  // it costs the well-behaved ones nothing. Skipped for the seamless tiles: those
  // are square by construction and padding would break the wrap.
  if (alpha && !seamless) {
    steps.push("pad='max(iw,ih)':'max(iw,ih)':'(ow-iw)/2':'(oh-ih)/2':color=0x00000000");
  }
  if (alpha) steps.push('premultiply=inplace=1');
  const scaled = seamless ? size * 3 : size;
  steps.push(`scale=${scaled}:${scaled}:flags=lanczos`);
  if (seamless) steps.push(`crop=${size}:${size}:${size}:${size}`);
  if (alpha) steps.push('unpremultiply=inplace=1');
  return steps.join(',');
}

function encode(sprite, work) {
  const src = join(SRC_DIR, `${sprite.name}.png`);
  const scaled = join(work, `${sprite.name}.png`);
  const out = join(OUT_DIR, `${sprite.name}.webp`);

  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', filterChain(sprite), '-frames:v', '1', scaled]);
  // `-alpha_q 100`: the alpha channel costs almost nothing at this resolution and
  // a soft-edged cutout is the one artefact that reads as "broken sprite".
  execFileSync('cwebp', ['-quiet', '-q', String(sprite.quality), '-m', '6', '-alpha_q', '100', scaled, '-o', out]);

  return { before: statSync(src).size, after: statSync(out).size };
}

const known = new Set(SPRITES.map((s) => s.name));
const orphans = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.png'))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((name) => !known.has(name));
if (orphans.length) {
  // A master with no entry would silently never ship. Louder than a comment.
  console.error(`Masters with no entry in SPRITES (add them or delete them): ${orphans.join(', ')}`);
  process.exitCode = 1;
}

const work = mkdtempSync(join(tmpdir(), 'dd-sprites-'));
let before = 0;
let after = 0;
try {
  for (const sprite of SPRITES) {
    const size = encode(sprite, work);
    before += size.before;
    after += size.after;
    const pad = sprite.name.padEnd(22);
    console.log(`${pad} ${String(sprite.size).padStart(4)}px  ${kb(size.before)} → ${kb(size.after)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${SPRITES.length} sprites: ${kb(before)} → ${kb(after)} (${Math.round((1 - after / before) * 100)}% smaller)`);

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1).padStart(7)} KB`;
}
