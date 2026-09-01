/**
 * Builds the game for itch.io and zips it into `itch.io/drone-directive-<version>.zip`.
 *
 * itch.io does not build anything: it unpacks the archive you upload and serves
 * `index.html` from it in an iframe. So this script has to produce the bundle
 * itself — and, unlike every other build here, produce a *different* one.
 *
 * The website is served from the root of its own domain, so `vite.config.ts`
 * sets `base: '/'` and the bundle's URLs are absolute (`/assets/index-*.js`).
 * itch serves a game from a per-upload subdirectory instead
 * (`html-classic.itch.zone/html/<id>/`), where every one of those absolute URLs
 * misses and the page comes up blank. Hence `--base=./` here, which also fixes
 * `import.meta.env.BASE_URL` — `config/sprites.ts` and `config/sounds.ts` build
 * their URLs from it, so with the wrong base the sprites and sounds 404 at
 * runtime even if the page loads.
 *
 * That base is the whole reason this is a script and not a line in a document:
 * it is a flag that must never be forgotten, and forgetting it fails only in a
 * browser, on itch, after an upload.
 *
 *   node scripts/pack-itch.mjs [--skip-build] [--allow-dev-relay] [--force]
 *
 * `client/dist` is never touched — it stays the artifact for Cloudflare and for
 * the npm package the desktop shell installs, both of which need `base: '/'`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Staged next to `client/.pack`, and ignored the same way. */
const staging = path.join(root, 'client/.itch');
const outDir = path.join(root, 'itch.io');

const skipBuild = process.argv.includes('--skip-build');
const allowDevRelay = process.argv.includes('--allow-dev-relay');
const force = process.argv.includes('--force');

const fail = (message) => {
  console.error(`pack-itch: ${message}`);
  process.exit(1);
};

/**
 * The version is the **root** `package.json`'s — the number `npm version` bumps
 * and tags, and the same one `pack-dist.mjs` publishes under. Every workspace's
 * own version is inert, so reading one of those would name the archive after a
 * number nobody maintains.
 */
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const archive = path.join(outDir, `drone-directive-${version}.zip`);

if (existsSync(archive) && !force) {
  fail(
    `itch.io/drone-directive-${version}.zip already exists.\n` +
      '  Bump the version in package.json, or re-run with --force to overwrite it.',
  );
}

// --- build ----------------------------------------------------------------

if (skipBuild) {
  if (!existsSync(path.join(staging, 'index.html'))) fail('--skip-build, but there is no build at client/.itch');
} else {
  await rm(staging, { recursive: true, force: true });
  console.log(`pack-itch: building client → client/.itch (base './')`);
  // Production mode, so `client/.env.production` supplies the relay hostname.
  execFileSync('npm', ['run', 'build', '-w', 'client', '--', '--base=./', '--outDir', '.itch'], {
    cwd: root,
    stdio: 'inherit',
  });
}

if (!existsSync(path.join(staging, 'index.html'))) fail('the build produced no index.html at client/.itch');

// --- checks ---------------------------------------------------------------

/**
 * The base flag is the failure this script exists to prevent, so it is verified
 * on the output rather than trusted from the input: a stale `.itch` reached
 * through `--skip-build`, or a Vite that stops honouring the flag, both look
 * exactly like success until the upload is live.
 */
const html = await readFile(path.join(staging, 'index.html'), 'utf8');
if (/(?:src|href)="\/(?!\/)/.test(html)) {
  fail('index.html still holds root-absolute asset URLs — the build ignored `--base=./` and would break on itch');
}

/**
 * The same guard `pack-dist.mjs` carries, for the same reason: a defined-but-
 * empty `VITE_MULTIPLAYER_URL` shadows `client/.env.production` and bakes in the
 * `ws://localhost:8787` dev fallback. On itch that is worse than on the website —
 * the page is served over HTTPS, so the browser blocks the insecure socket and
 * online play fails silently while the match against the bot looks fine.
 */
const assets = path.join(staging, 'assets');
const scripts = existsSync(assets) ? (await readdir(assets)).filter((f) => f.endsWith('.js')) : [];
const localhostIn = [];
for (const file of scripts) {
  if ((await readFile(path.join(assets, file), 'utf8')).includes('localhost:8787')) localhostIn.push(file);
}
if (localhostIn.length > 0 && !allowDevRelay) {
  fail(
    `the build points at the dev relay (ws://localhost:8787) — found in ${localhostIn.join(', ')}.\n` +
      '  Check that VITE_MULTIPLAYER_URL is unset in the environment, or,\n' +
      '  if this is deliberate, re-run with --allow-dev-relay.',
  );
}

// --- archive --------------------------------------------------------------

/**
 * `zip -j` would be wrong and `zip` from the repo root would be worse: itch
 * requires `index.html` at the *root* of the archive, with the asset tree
 * preserved under it. Zipping from inside the staging directory with `.` is what
 * gives both.
 */
await mkdir(outDir, { recursive: true });
await rm(archive, { force: true });
try {
  execFileSync('zip', ['-rqX', archive, '.', '-x', '.*'], { cwd: staging, stdio: 'inherit' });
} catch (error) {
  fail(`could not run \`zip\` (${error.code === 'ENOENT' ? 'not installed' : error.message})`);
}

const entries = await readdir(staging, { recursive: true });
const { size } = await stat(archive);
console.log(
  `pack-itch: itch.io/drone-directive-${version}.zip — ${entries.length} entries, ${(size / 1e6).toFixed(1)} MB`,
);
if (localhostIn.length > 0) console.log('pack-itch: WARNING — bundle points at the dev relay (--allow-dev-relay)');
console.log('pack-itch: upload it as the HTML project file, ticking "This file will be played in the browser"');
