/**
 * Re-encodes the favicon master in `assets-src/favicon.png` into the icon files
 * the site actually serves from `public/`.
 *
 * Run by hand after the icon changes (`node scripts/encode-favicon.mjs`) and
 * commit the output — same deal as `encode-sprites.mjs`, and for the same reason:
 * the input changes about once a year and the toolchain is not an npm dependency.
 * Requires only `ffmpeg` on PATH (no `cwebp` here — no browser takes a WebP
 * favicon from a `rel=icon` link without a PNG fallback, so there is nothing to
 * gain by shipping one).
 *
 * Three things here are not obvious:
 *
 * 1. **The master's padding is thrown away and re-applied.** Generators centre
 *    the mark in a generous frame — this one arrived 340 px of art inside a
 *    500 px canvas, i.e. 32% of the width spent on empty margin. That is fine for
 *    a sprite and ruinous for a favicon: at 16 px it leaves an 11 px mark. The
 *    alpha bounding box is measured, cropped to, and re-padded to a fixed
 *    fraction of each output size.
 * 2. **Premultiply before scaling**, exactly as the sprite encoder does — RGBA
 *    (0,0,0,0) is *black*, and averaging it into the edge pixels of a 500→16 px
 *    downscale is where dark fringes come from. At this scale factor it is the
 *    difference between a clean mark and a smudge.
 * 3. **The `.ico` embeds PNGs rather than BMPs.** Every browser since IE11 and
 *    every Windows since Vista reads that, it is a third of the size, and it
 *    keeps the alpha channel without the AND-mask dance the BMP form needs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../assets-src/favicon.png', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** The game's background, `palette.background` — see `src/config/palette.ts`. */
const PLATE = '0x0d1117';

/**
 * The sizes inside `favicon.ico`. 16 and 32 are what browsers actually draw (tab
 * and retina tab / bookmark bar); 48 is what Windows uses for a pinned site and
 * costs 700 bytes.
 */
const ICO_SIZES = [16, 32, 48];

/**
 * How much of each output the mark fills.
 *
 * The favicon is nearly edge to edge — a tab is 16 px and every one of them
 * counts. The Apple touch icon is not: iOS rounds and masks it itself, so art in
 * the corners gets cut, and it is composited on a home screen rather than in a
 * strip of other icons.
 */
const FILL = 0.9;
const APPLE_FILL = 0.72;
const APPLE_SIZE = 180;

/**
 * The tight bounding box of everything non-transparent in the master.
 *
 * Decoded through ffmpeg to raw RGBA and scanned here rather than left to
 * `cropdetect`, which thresholds on luma — it would happily crop away the dark
 * outline this mark is drawn with.
 */
function alphaBounds(src) {
  const probe = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', src,
  ]).toString().trim();
  const [width, height] = probe.split('x').map(Number);

  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { maxBuffer: width * height * 4 + 1024 },
  );

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Anything above fully transparent counts: a soft antialiased edge is part
      // of the shape, and clipping it is visible at 16 px.
      if (raw[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error(`${src} is fully transparent`);

  // Square it off around the centre of the content, so a mark that is a few
  // pixels wider than it is tall keeps its proportions instead of being padded
  // asymmetrically.
  const side = Math.max(right - left + 1, bottom - top + 1);
  const cx = (left + right + 1) / 2;
  const cy = (top + bottom + 1) / 2;
  return {
    side,
    x: Math.round(cx - side / 2),
    y: Math.round(cy - side / 2),
    source: { width, height },
  };
}

/**
 * Crops to the mark, scales it to `size * fill`, and pads back out to `size`.
 *
 * `plate` opaque means the result is flattened onto the game's background rather
 * than left transparent — which is not a style choice but a platform one: iOS
 * composites a transparent touch icon onto black, so an icon drawn with a dark
 * outline would lose its edges on the home screen.
 */
function render(bounds, { size, fill, plate = false, out }) {
  const inner = Math.round(size * fill);
  const offset = Math.round((size - inner) / 2);
  const steps = [
    `crop=${bounds.side}:${bounds.side}:${bounds.x}:${bounds.y}`,
    'format=rgba',
    'premultiply=inplace=1',
    `scale=${inner}:${inner}:flags=lanczos`,
    'unpremultiply=inplace=1',
    `pad=${size}:${size}:${offset}:${offset}:color=${plate ? PLATE : '0x00000000'}`,
  ];
  if (plate) steps.push('format=rgb24');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', SRC, '-vf', steps.join(','), '-frames:v', '1', out]);
  return out;
}

/**
 * Wraps already-encoded PNGs in an ICO container: a 6-byte header, one 16-byte
 * directory entry per image, then the images back to back.
 */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon (2 would be a cursor)
  header.writeUInt16LE(pngs.length, 4);

  const directory = Buffer.alloc(16 * pngs.length);
  let offset = header.length + directory.length;
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16;
    // 0 means 256 in this field; nothing here is that big, but the rule is why
    // the byte is written rather than the number.
    directory.writeUInt8(size >= 256 ? 0 : size, e);
    directory.writeUInt8(size >= 256 ? 0 : size, e + 1);
    directory.writeUInt8(0, e + 2); // palette size — 0 for truecolour
    directory.writeUInt8(0, e + 3); // reserved
    directory.writeUInt16LE(1, e + 4); // colour planes
    directory.writeUInt16LE(32, e + 6); // bits per pixel
    directory.writeUInt32LE(data.length, e + 8);
    directory.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });

  return Buffer.concat([header, directory, ...pngs.map((p) => p.data)]);
}

const work = mkdtempSync(join(tmpdir(), 'dd-favicon-'));
try {
  const bounds = alphaBounds(SRC);
  const { width, height } = bounds.source;
  console.log(
    `master ${width}×${height}, mark ${bounds.side}×${bounds.side} ` +
      `(${Math.round((bounds.side / width) * 100)}% of the frame) → re-padded to ${Math.round(FILL * 100)}%`,
  );

  const pngs = ICO_SIZES.map((size) => ({
    size,
    data: readFileSync(render(bounds, { size, fill: FILL, out: join(work, `icon-${size}.png`) })),
  }));
  const ico = join(OUT_DIR, 'favicon.ico');
  writeFileSync(ico, buildIco(pngs));
  console.log(`favicon.ico          ${ICO_SIZES.join('/')}px  ${kb(statSync(ico).size)}`);

  const apple = join(OUT_DIR, 'apple-touch-icon.png');
  render(bounds, { size: APPLE_SIZE, fill: APPLE_FILL, plate: true, out: apple });
  console.log(`apple-touch-icon.png ${APPLE_SIZE}px      ${kb(statSync(apple).size)}  (opaque, on ${PLATE})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
