import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

  return {
    // The site is served from the root of its own domain, so absolute paths are
    // correct. (It used to be `./` in production, to survive GitHub Pages serving
    // the game from a `/<repo>/` subpath.)
    base: '/',
    plugins: [react(), token ? cloudflareWebAnalytics(token) : null],
  };
});
