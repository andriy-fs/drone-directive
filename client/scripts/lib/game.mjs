/**
 * Boots the game in a real browser and drives it as far as a match, so a script
 * that wants a picture of the battlefield can ask for one in a line.
 *
 * Split out from `screenshot.mjs` because the driving is the part worth reusing:
 * a future visual test wants exactly this — a dev server, a page, a started match —
 * and nothing of the CLI wrapped around it.
 *
 * **The menu is crossed by clicking, not by poking the store.** Reaching into
 * `useGameStore` from the page would skip the very seam (`GameCanvas` + `useGameApp`)
 * that a screenshot is most likely to be checking, and would break the moment the
 * store is refactored — where the button survives anything that keeps the game
 * playable.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findChromium } from './chromium.mjs';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The Start button, in every language the UI ships. */
const START_BUTTON = /^(Start|Начать|Почати)$/;

/**
 * Starts `npm run dev` and resolves once Vite prints the URL it settled on —
 * which is not always 5173, since Vite steps to the next free port when one is
 * taken. Parsing the banner is what keeps a screenshot run from silently
 * photographing a *different* dev server that happens to be up.
 */
export async function startDevServer({ timeoutMs = 30000 } = {}) {
  // Its own process group, so stopping it takes the Vite child down with the npm
  // wrapper rather than orphaning it on the port.
  const child = spawn('npm', ['run', 'dev'], { cwd: clientRoot, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };

  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`dev server did not come up within ${timeoutMs} ms`));
    }, timeoutMs);

    let log = '';
    child.stdout.on('data', (chunk) => {
      log += chunk;
      const match = /Local:\s+(http:\/\/\S+?)\/?\s/.exec(log);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    child.stderr.on('data', (chunk) => (log += chunk));
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev server exited with code ${code}\n${log}`));
    });
  });

  return { url, stop };
}

/**
 * Opens the game and, unless `menu` is set, starts a match and waits for it to
 * settle.
 *
 * `query` is appended to the URL, which is how the render layers are switched
 * (`?debris=0`, `?peaks=0&fog=0` — see `pixi/perf/perfFlags.ts`) and how a match is
 * pinned to a seed (`?seed=7`) so two runs are comparable. Page errors and console
 * errors are reported through `onError`, because a canvas that failed to draw looks
 * exactly like a canvas with nothing on it.
 */
export async function openGame(
  browser,
  { url, query = '', menu = false, settleMs = 4000, viewport = { width: 1280, height: 800 }, dpr = 2, onError } = {},
) {
  // Viewport and scale go in at page creation: `deviceScaleFactor` cannot be changed
  // afterwards, and the game reads `devicePixelRatio` when it builds the renderer.
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
  if (onError) {
    page.on('pageerror', (e) => onError(`page error: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && onError(`console error: ${m.text()}`));
  }

  const q = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  await page.goto(`${url}/${q}`, { waitUntil: 'networkidle' });
  if (menu) return page;

  // Matched on the button's text rather than its accessible name: the name carries
  // more than the label (`getByRole` with an anchored /^Start$/ finds nothing),
  // and an unanchored match would also take "Restart".
  const start = page.locator('button').filter({ hasText: START_BUTTON });
  await start.first().click({ timeout: 15000 });
  // Nothing in the DOM says "the battlefield has been drawn" — the field is one
  // canvas — so this waits out the fixed-step loop rather than an element.
  await page.waitForTimeout(settleMs);
  return page;
}

/** Launches the browser found by `findChromium`. */
export async function launchBrowser({ headless = true } = {}) {
  return chromium.launch({ headless, executablePath: findChromium({ headless }) });
}
