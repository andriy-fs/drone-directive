/**
 * Finds a Chromium to drive, without downloading one.
 *
 * The dependency is **`playwright-core`, not `playwright`** — deliberately. The
 * `playwright` package downloads ~300 MB of browsers in a postinstall hook, which
 * every contributor and every CI run would then pay for a tool that is used to
 * take the occasional screenshot. `playwright-core` ships the driver only and is
 * happy to launch a binary you hand it, which is what this module finds.
 *
 * The search order goes from "the user said so" to "something plausible is already
 * on this machine":
 *
 * 1. `DD_CHROMIUM` — an explicit path to a binary. The escape hatch; nothing below
 *    is consulted if it is set.
 * 2. Playwright's browser caches, including `PLAYWRIGHT_BROWSERS_PATH` and the
 *    per-app caches that sandboxed editors keep (a Flatpak VS Code puts its own
 *    under `~/.var/app/…`, and on a dev machine that is often the only one that is
 *    populated). The highest build number wins; the headless shell is preferred
 *    over the full browser when headless, since it is the smaller process.
 * 3. A system Chrome/Chromium/Edge on `PATH`.
 *
 * **Version skew is fine here.** The protocol surface a screenshot uses — navigate,
 * click, capture — has been stable across Chromium releases for years, so pairing
 * whatever build is on disk with whatever `playwright-core` is installed is not the
 * gamble it sounds like. If a future need turns out to be version-sensitive, pin it
 * with `DD_CHROMIUM` rather than adding a download step here.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where Playwright unpacks browsers, most specific first. */
function cacheRoots() {
  const home = homedir();
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  roots.push(join(home, '.cache', 'ms-playwright'));
  roots.push(join(home, 'Library', 'Caches', 'ms-playwright')); // macOS

  // Sandboxed editors keep their own copy; on a machine where the browsers were
  // only ever installed from inside the IDE, this is the one that has them.
  const flatpak = join(home, '.var', 'app');
  if (existsSync(flatpak)) {
    for (const app of readdirSync(flatpak)) roots.push(join(flatpak, app, 'cache', 'ms-playwright'));
  }
  return roots.filter((r) => existsSync(r));
}

/** The binary inside an unpacked browser directory, across the layouts Playwright has used. */
function binaryIn(dir) {
  const candidates = [
    join(dir, 'chrome-linux64', 'chrome'),
    join(dir, 'chrome-linux', 'chrome'),
    join(dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
    join(dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    join(dir, 'chrome-headless-shell-mac', 'chrome-headless-shell'),
  ];
  return candidates.find(existsSync) ?? null;
}

function fromCaches(headless) {
  const found = [];
  for (const root of cacheRoots()) {
    for (const entry of readdirSync(root)) {
      const m = /^chromium(_headless_shell)?-(\d+)$/.exec(entry);
      if (!m) continue;
      const binary = binaryIn(join(root, entry));
      if (binary) found.push({ binary, shell: Boolean(m[1]), build: Number(m[2]) });
    }
  }
  if (!found.length) return null;

  // Newest build first; among equals, the headless shell when we are headless.
  found.sort((a, b) => b.build - a.build || Number(b.shell === headless) - Number(a.shell === headless));
  return found[0].binary;
}

function fromPath() {
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    try {
      return execFileSync('command', ['-v', name], { shell: true, encoding: 'utf8' }).trim() || null;
    } catch {
      /* not on PATH */
    }
  }
  return null;
}

/**
 * Absolute path to a Chromium binary. Throws with instructions rather than
 * returning null — every caller needs one, and a null would only be re-thrown a
 * line later with less to say.
 */
export function findChromium({ headless = true } = {}) {
  const explicit = process.env.DD_CHROMIUM;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`DD_CHROMIUM points at nothing: ${explicit}`);
    return explicit;
  }

  const found = fromCaches(headless) ?? fromPath();
  if (found) return found;

  throw new Error(
    'No Chromium found. Either install one for Playwright:\n' +
      '  npx playwright-core install chromium\n' +
      'or point at a browser you already have:\n' +
      '  DD_CHROMIUM=/usr/bin/google-chrome npm run shot',
  );
}
