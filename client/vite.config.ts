import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Identifies the running bundle, so a client can tell whether the site has moved
 * on since it loaded. A git SHA rather than the package version: deploys happen
 * on every push to `main`, and a version number would only change on a release —
 * most deploys would go unnoticed.
 *
 * `dev` outside a build (and wherever git is unavailable) is a value the update
 * check reads as "don't check": there is no manifest on the dev server, since the
 * plugin below is build-only.
 */
function resolveBuildId(): string {
  const fromCi = process.env.GITHUB_SHA?.trim();
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'dev';
  }
}

/**
 * `PROTOCOL_VERSION`, read out of the workspace source rather than copied here.
 *
 * It cannot simply be imported: this config is loaded by Node, and
 * `@drone-directive/protocol` resolves to raw `.ts` (fine for the bundle, which
 * Vite compiles; not for the config loader). Parsing keeps the number in exactly
 * one place, and throwing on a miss means a rename fails the build instead of
 * shipping a manifest that quietly disagrees with the relay.
 */
function readProtocolVersion(): number {
  const source = readFileSync(fileURLToPath(new URL('../protocol/src/index.ts', import.meta.url)), 'utf8');
  const match = /export const PROTOCOL_VERSION = (\d+)/.exec(source);
  if (!match) throw new Error('vite.config: could not read PROTOCOL_VERSION from protocol/src/index.ts');
  return Number(match[1]);
}

/**
 * Emits `version.json` beside `index.html`: what the running client compares
 * itself against (see `config/version.ts`).
 */
function versionManifest(buildId: string): Plugin {
  return {
    name: 'dd:version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ build: buildId, protocol: readProtocolVersion() }, null, 2)}\n`,
      });
    },
  };
}

/**
 * Injects the Cloudflare Web Analytics beacon into the built `index.html`.
 *
 * The beacon is cookieless and does no fingerprinting, so it needs no consent
 * banner. It ships only when `VITE_CF_BEACON_TOKEN` is set and only in a build,
 * which keeps the dev server (and anyone building without the token) out of the
 * stats. The token is public by design — it is visible in the page source.
 */
function cloudflareWebAnalytics(token: string): Plugin {
  const beacon =
    `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" ` +
    `data-cf-beacon='${JSON.stringify({ token })}'></script>`;

  return {
    name: 'dd:cloudflare-web-analytics',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</body>', `  ${beacon}\n  </body>`);
    },
  };
}

export default defineConfig(({ mode }) => {
  // `||` (not `??`): CI expands an unset `${{ vars.VITE_CF_BEACON_TOKEN }}` to an
  // empty string, which must count as "no analytics" just like an absent var.
  const token = loadEnv(mode, process.cwd(), 'VITE_').VITE_CF_BEACON_TOKEN?.trim() || '';
  const buildId = resolveBuildId();

  return {
    // Compiled in, so the bundle knows its own identity without a second fetch.
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    // The site is served from the root of its own domain, so absolute paths are
    // correct. (It used to be `./` in production, to survive GitHub Pages serving
    // the game from a `/<repo>/` subpath.)
    base: '/',
    plugins: [react(), versionManifest(buildId), token ? cloudflareWebAnalytics(token) : null],
  };
});
