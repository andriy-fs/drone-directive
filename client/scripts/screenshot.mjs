/**
 * Screenshots the running game.
 *
 * ```
 * npm run shot                          # a match, to screenshots/shot.png
 * npm run shot -- --out before.png --query 'cliffs=0&peaks=0'
 * npm run shot -- --seed 7 --out a.png  # same battlefield every time
 * npm run shot -- --menu --out menu.png
 * npm run shot -- --url http://localhost:5173   # use a dev server already running
 * ```
 *
 * It starts and stops its own dev server unless `--url` says otherwise, so the
 * one-liner above is the whole procedure — there is no setup step to forget.
 *
 * **Pass `--seed` whenever the shot is a comparison.** Maps are generated from the
 * clock, so two runs without it photograph two different battlefields, and a render
 * change judged against them is being judged against noise.
 *
 * The browser comes from `lib/chromium.mjs`, which finds one already on the machine
 * rather than downloading 300 MB — see that file for the search order and for
 * `DD_CHROMIUM`.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, openGame, startDevServer } from './lib/game.mjs';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  out: 'screenshots/shot.png',
  url: null,
  query: '',
  seed: null,
  menu: false,
  settle: 4000,
  size: '1280x800',
  dpr: 2,
  headed: false,
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (name === 'menu' || name === 'headed') {
      opts[name] = true;
      continue;
    }
    if (!(name in DEFAULTS)) throw new Error(`unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    opts[name] = name === 'settle' || name === 'dpr' || name === 'seed' ? Number(value) : value;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const [width, height] = opts.size.split('x').map(Number);
if (!width || !height) throw new Error(`--size wants WxH, got ${opts.size}`);

// `--seed` is just another URL parameter, but it is the one that decides whether
// two shots can be compared at all, so it gets its own flag.
const query = [opts.query, opts.seed === null ? '' : `seed=${opts.seed}`].filter(Boolean).join('&');

const server = opts.url ? null : await startDevServer();
const url = opts.url ?? server.url;
const browser = await launchBrowser({ headless: !opts.headed });

// Errors are collected rather than thrown: a shot of a broken frame is more use
// than no shot, so the picture is taken and the problems reported alongside it.
const problems = [];
try {
  const page = await openGame(browser, {
    url,
    query,
    menu: opts.menu,
    settleMs: opts.settle,
    viewport: { width, height },
    dpr: opts.dpr,
    onError: (e) => problems.push(e),
  });

  const out = resolve(clientRoot, opts.out);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(out);
} finally {
  await browser.close();
  server?.stop();
}

if (problems.length) {
  console.error(`\n${problems.length} error(s) while loading:`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exitCode = 1;
}
