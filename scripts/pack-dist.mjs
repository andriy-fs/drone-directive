/**
 * Stages the built game as a publishable npm package under `client/.pack`.
 *
 * `client/` itself is not publishable and is not meant to be: it is `private`,
 * and it depends on four workspace siblings by `"*"`, which no registry can
 * resolve. None of that matters to a consumer — `vite build` has already
 * inlined every one of those into the bundle. So what gets published is not the
 * workspace but its *output*: `client/dist` plus a generated manifest with zero
 * dependencies.
 *
 * The result is a static-asset package. It has no entry point and nothing
 * `import`s it; a desktop shell (see `.docs/deployment.md` § "Publishing the
 * client to GitHub Packages") installs it and copies `dist/` into its bundle.
 *
 *   node scripts/pack-dist.mjs [--allow-dev-relay]
 *
 * Run `npm run build` first — this script never builds, it only packages, so
 * that what is published is exactly the tree that was tested.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'client/dist');
const staging = path.join(root, 'client/.pack');

/**
 * The scope is not a preference: GitHub Packages only accepts a package whose
 * scope matches the owner of the repository it is published from, so
 * `@drone-directive/client` cannot go there under this account. Renaming the
 * workspace was the alternative and is worse — that name is load-bearing in six
 * workspaces' imports, and it is the *published* artifact that needs the new
 * name, not the source.
 */
const PACKAGE_NAME = '@andriy-fs/drone-directive-client';
const REPOSITORY = 'https://github.com/andriy-fs/drone-directive';

const allowDevRelay = process.argv.includes('--allow-dev-relay');

const fail = (message) => {
  console.error(`pack-dist: ${message}`);
  process.exit(1);
};

// --- what is being packed -------------------------------------------------

if (!existsSync(path.join(dist, 'index.html'))) {
  fail('no build found at client/dist — run `npm run build` first');
}

const { version, license } = JSON.parse(await readFile(path.join(root, 'client/package.json'), 'utf8'));

/**
 * Guard against the trap documented in `client/.env.production`: a defined-but-
 * empty `VITE_MULTIPLAYER_URL` shadows the env file, and the bundle then carries
 * the `ws://localhost:8787` dev fallback. On the website that is merely wrong;
 * in a desktop build shipped to users it is unfixable without a new release.
 */
const assets = path.join(dist, 'assets');
const scripts = existsSync(assets) ? (await readdir(assets)).filter((f) => f.endsWith('.js')) : [];
const localhostIn = [];
for (const file of scripts) {
  if ((await readFile(path.join(assets, file), 'utf8')).includes('localhost:8787')) localhostIn.push(file);
}
if (localhostIn.length > 0 && !allowDevRelay) {
  fail(
    `the build points at the dev relay (ws://localhost:8787) — found in ${localhostIn.join(', ')}.\n` +
      '  Rebuild with `npm run build` (production mode reads client/.env.production), or,\n' +
      '  if this is deliberate, re-run with --allow-dev-relay.',
  );
}

// --- stage ----------------------------------------------------------------

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(dist, path.join(staging, 'dist'), { recursive: true });

const manifest = {
  name: PACKAGE_NAME,
  version,
  description: 'Drone Directive — the built browser game, as static assets for a desktop shell.',
  license,
  // No `main`/`exports`: nothing imports this. Consumers copy `dist/`.
  files: ['dist'],
  // Links the package to the repository on GitHub, which is what makes it
  // inherit that repository's visibility and permissions.
  repository: { type: 'git', url: `git+${REPOSITORY}.git` },
  homepage: 'https://drone-directive.space',
  publishConfig: { registry: 'https://npm.pkg.github.com' },
};

await writeFile(path.join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  path.join(staging, 'README.md'),
  `# ${PACKAGE_NAME}

The production build of [Drone Directive](${REPOSITORY}) — a top-down RTS for the
browser — packaged as static assets so a desktop shell can ship it offline.

There is no entry point and nothing to \`import\`. The package contains one
directory, \`dist/\`, holding \`index.html\`, hashed JS/CSS, sprites and sounds:

\`\`\`js
import { createRequire } from 'node:module';
const game = createRequire(import.meta.url).resolve('${PACKAGE_NAME}/package.json');
// → copy \`path.join(path.dirname(game), 'dist')\` into your app bundle
\`\`\`

Serve it from a directory root (the game is built with Vite \`base: '/'\`, so its
asset URLs are absolute). Version \`${version}\`; the multiplayer relay hostname is
baked in at build time.

Licensed ${license}. Source, issues and the game itself: ${REPOSITORY}
`,
);

const files = await readdir(path.join(staging, 'dist'), { recursive: true });
console.log(`pack-dist: staged ${PACKAGE_NAME}@${version} → client/.pack (${files.length} entries)`);
if (localhostIn.length > 0) console.log('pack-dist: WARNING — bundle points at the dev relay (--allow-dev-relay)');
console.log('pack-dist: publish with `npm publish client/.pack` (needs NODE_AUTH_TOKEN)');
