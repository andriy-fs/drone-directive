/**
 * The desktop shell's update check — and, as a by-product, the only count we have
 * of the desktop build's users.
 *
 * The shell (`andriy-fs/drone-directive-desktop`) asks this route once per launch
 * whether a newer release of *itself* exists. It deliberately does not ask about
 * the game: a shell release pins exactly one game version, so the shell's number
 * already identifies both. It equally deliberately does not ask GitHub's API —
 * that would answer the same question while telling us nothing, and it is rate
 * limited per IP.
 *
 * What is recorded is what the request carries and nothing else: the version, the
 * OS, the architecture, and the country Cloudflare derives from the connection.
 * No identifier is sent or stored, so this counts *launches*, not people, and a
 * player who never launches the app is invisible to it. Cloudflare sees the IP in
 * transit as it does for every request; nothing here writes it down. The shell
 * documents all of this in its README and turns the whole thing off with
 * `--no-update-check`.
 */

/** Where the shell asks. Kept here so the route and its handler move together. */
export const DESKTOP_VERSION_PATH = '/desktop/version';

/** Where a player is sent to get the new build. The shell opens this in a browser. */
const RELEASES_URL = 'https://github.com/andriy-fs/drone-directive-desktop/releases/latest';

/**
 * What a caller-supplied dimension may look like. These strings come off the query
 * string of a public endpoint and land in an analytics dataset as grouping keys, so
 * the point is not escaping — it is **cardinality**: without this, anyone could turn
 * the dataset into unbounded garbage one request at a time.
 */
const DIMENSION = /^[0-9a-z._-]{1,24}$/;

const dimension = (value: string | null): string =>
  value === null ? 'unknown' : DIMENSION.test(value) ? value : 'other';

/**
 * The two-letter country Cloudflare derived from the connection. Narrowed rather
 * than cast: `request.cf` is typed as an open bag, and a `String()` around it would
 * happily record `[object Object]` if it ever stopped being a string.
 */
const country = (request: Request): string => (typeof request.cf?.country === 'string' ? request.cf.country : '');

/**
 * The env this route needs. Declared here rather than in `Env` itself so the
 * handler and its bindings stay one unit; `Env` extends it.
 *
 * The dataset is optional on purpose: `wrangler dev` runs without one bound, and a
 * missing binding must not turn the update check into a 500 — the version answer is
 * the part players depend on, the count is the side effect.
 */
export interface DesktopEnv {
  /** The newest published shell release, bumped by hand at release time. */
  DESKTOP_LATEST: string;
  DESKTOP_LAUNCHES?: AnalyticsEngineDataset;
}

/** `{ latest, url }` — the shell compares `latest` against its own `app.getVersion()`. */
export function handleDesktopVersion(request: Request, env: DesktopEnv, url: URL): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }

  env.DESKTOP_LAUNCHES?.writeDataPoint({
    blobs: [
      dimension(url.searchParams.get('shell')),
      dimension(url.searchParams.get('os')),
      dimension(url.searchParams.get('arch')),
      country(request),
    ],
    doubles: [1],
    // The sampling key. Version is the dimension we always slice by, and it has the
    // low cardinality an index wants.
    indexes: [dimension(url.searchParams.get('shell'))],
  });

  return new Response(JSON.stringify({ latest: env.DESKTOP_LATEST, url: RELEASES_URL }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The answer changes the moment a release is cut, and it is one small JSON a
      // few times a day — there is nothing here worth serving stale.
      'cache-control': 'no-store',
    },
  });
}
