/**
 * Screenshots the wireframe view without playing the game.
 *
 * ```
 * npm run shot:fpv                                  # a massif, to screenshots/fpv.png
 * npm run shot:fpv -- --pose crater --out pit.png
 * npm run shot:fpv -- --pose plain --seed 12
 * npm run shot:fpv -- --x 600 --y 800 --heading 90  # an explicit spot: world px, degrees
 * npm run shot:fpv -- --all --out-dir screenshots/before   # one of each pose
 * ```
 *
 * **It photographs `/fpv-lab.html`, not a match.** The monitor only comes on when a
 * drone lands on a hull, and getting there in a browser means waiting for a robot to
 * be built, flying the drone across the map and landing it — a minute per look, on a
 * camera that stops somewhere slightly different every time. The bench builds a map,
 * one robot and an all-seeing fog, then renders one frame of the real `FpvView` at a
 * pose it finds in the terrain. See `src/devtools/fpvLab.ts` for what is and is not
 * faithful about that.
 *
 * **Pass `--seed` whenever the shot is a comparison** — the same reason `shot` does.
 * The default is fixed rather than clock-based here, so plain reruns already compare.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, startDevServer } from './lib/game.mjs';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const POSES = ['cliff', 'crater', 'plain'];

const DEFAULTS = {
  out: 'screenshots/fpv.png',
  outDir: 'screenshots',
  url: null,
  pose: 'cliff',
  seed: 7,
  x: null,
  y: null,
  heading: null,
  size: '1280x800',
  dpr: 2,
  all: false,
  headed: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (name === 'all' || name === 'headed') {
      opts[name] = true;
      continue;
    }
    if (!(name in DEFAULTS)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    opts[name] = ['seed', 'dpr', 'x', 'y', 'heading'].includes(name) ? Number(value) : value;
  }
  if (!POSES.includes(opts.pose)) throw new Error(`--pose wants one of ${POSES.join('|')}, got ${opts.pose}`);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const [width, height] = opts.size.split('x').map(Number);
if (!width || !height) throw new Error(`--size wants WxH, got ${opts.size}`);

/** One shot of the bench at one pose. */
async function shoot(browser, url, { pose, out, problems }) {
  const query = new URLSearchParams({ seed: String(opts.seed), pose });
  for (const name of ['x', 'y', 'heading']) {
    if (opts[name] !== null) query.set(name, String(opts[name]));
  }

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: opts.dpr });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console error: ${m.text()}`));

  try {
    await page.goto(`${url}/fpv-lab.html?${query}`, { waitUntil: 'load' });
    // The bench sets this once the first frame is on the canvas. A shader that failed
    // to compile never gets here, which is the failure this most needs to not sleep
    // through — WebGL reports it on the console and draws nothing.
    await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log(out);
  } finally {
    await page.close();
  }
}

const server = opts.url ? null : await startDevServer();
const url = opts.url ?? server.url;
const browser = await launchBrowser({ headless: !opts.headed });

// Errors are collected rather than thrown, exactly as in `screenshot.mjs`: a picture
// of a broken frame is more use than no picture.
const problems = [];
try {
  if (opts.all) {
    for (const pose of POSES) {
      await shoot(browser, url, { pose, out: resolve(clientRoot, opts.outDir, `fpv-${pose}.png`), problems });
    }
  } else {
    await shoot(browser, url, { pose: opts.pose, out: resolve(clientRoot, opts.out), problems });
  }
} finally {
  await browser.close();
  server?.stop();
}

if (problems.length) {
  console.error(`\n${problems.length} error(s) while rendering:`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exitCode = 1;
}
