# Deploy (UI + relay Worker on push to `main`)

Both halves of the game are deployed to **Cloudflare**, from `.github/workflows/deploy.yml`,
on every push to `main`:

| Half         | Workspace | Wrangler config        | Hostname                       |
| ------------ | --------- | ---------------------- | ------------------------------ |
| The game     | `client`  | `client/wrangler.toml` | `drone-directive.space`, `www` |
| Relay Worker | `server`  | `server/wrangler.toml` | `relay.drone-directive.space`  |

The two deploys are independent and run in parallel. They're linked only by one
build-time value — the relay hostname baked into the UI bundle from
`client/.env.production` (see below). That hostname is stable, so there's no
ordering dependency.

## Why two hostnames and not one origin

Serving the game and the relay from a single origin would be tidier — one deploy,
one name, no cross-origin anything. It does not work as the protocol stands: the
relay routes a **match at the root path** (`/?room=…`, see `server/src/index.ts`),
which is exactly where the static site's `index.html` lives. With `[assets]`
configured, Cloudflare matches assets before running the Worker, so `/` would
return HTML and the WebSocket upgrade would never reach `Room`.

Collapsing them would mean moving the match endpoint off `/` — a change to
`protocol/`, `net/`, `server/` and their tests, plus a `PROTOCOL_VERSION` bump. A
subdomain costs nothing and keeps the two halves independent, which is the property
the rest of the architecture is built around.

## The client deploy is an assets-only Worker

`client/wrangler.toml` declares **no `main`** — only `[assets]`. No script runs per
request; Cloudflare serves `client/dist` from its edge. That is why:

- **No compression plugin is needed.** Cloudflare applies Brotli/gzip on the fly
  based on `Accept-Encoding`. A `vite-plugin-compression2`-style sidecar (`.br`/`.gz`
  next to each file) would be dead weight — nothing negotiates it.
- **`base` is `/`** in `client/vite.config.ts`. It used to be `./` in production
  purely to survive GitHub Pages serving the game from a `/<repo>/` subpath.
- **`not_found_handling` is left at the default** (a real 404). The game has no
  client-side routes to deep-link into, so the SPA fallback would only mask a
  mistyped asset URL as `200 text/html`.

### Files at the root of the deploy

Everything in `client/public/` is mirrored into `dist/` by Vite, which is how these
end up at the root of the served site — or, for the first two, at the root of the
assets directory where wrangler reads them as config and never serves them:

- **`_headers`** — the caching policy. Cloudflare's default for assets is
  `max-age=0, must-revalidate`, which is correct and needlessly expensive: only
  `/assets/*` is content-hashed, so a returning player would revalidate ~270
  unhashed files before a match could start. Four tiers, longest-lived first:
  `/assets/*` is `immutable` for a year (a changed file is a changed URL); icons
  and the social card get a week; sounds and music a day; sprites (`/*.webp`) an
  hour, because the art pipeline overwrites them in place and art is what gets
  iterated. Everything but `/assets/*` and `index.html` also carries
  `stale-while-revalidate`, which is what makes the short windows cheap — the
  browser paints from cache immediately and refreshes in the background.
  `index.html` stays on `must-revalidate`: its URL never changes but its contents
  name every hashed chunk, so a stale copy pins a previous deploy.
- **`.assetsignore`** — keeps `public/.tmp/` (the sprite pipeline's scratch space,
  ~12 MB of PNG masters) off the CDN. It's gitignored, so CI never sees it, but a
  deploy from a local working tree is not a clean checkout and would ship it.
- **`robots.txt`** — only a `Sitemap:` line. Cloudflare's zone-level **Managed
  robots.txt** prepends its own block (a `Content-Signal` header, `Allow: /` for
  everyone, and `Disallow: /` for named AI crawlers), so search engines are already
  allowed and anything more here would only duplicate it. Turn the managed block
  off in the dashboard (Settings → AI Crawl Control) if you'd rather AI crawlers
  could read the site.
- **`sitemap.xml`** — one `<loc>`, the apex. The game is a single page with no
  routes, and the four UI languages are store state rather than URLs, so there is
  nothing else to list and no `hreflang` to declare.
- **`social-card.jpg`** — the `og:image`, cropped to 1.91:1 from the backdrop
  master; regenerate it with the command in `.docs/sprites/menu-backdrop.md`.

The `<head>` in `client/index.html` carries the rest of the search/social metadata:
description, `rel=canonical` at the apex (needed because `www` serves the same
Worker and would otherwise be duplicate content), Open Graph + Twitter card, and a
`VideoGame` JSON-LD block. `<html lang>` ships as `en` and is rewritten at runtime
from the store's locale in `client/src/main.tsx`.

## Where the relay hostname comes from

`client/.env.production`, and nowhere else. It is committed, because `VITE_*` values
end up readable in the bundle anyway.

This used to be a CI variable and must not go back to being one. Vite's precedence
has a sharp edge: a **defined but empty** `VITE_MULTIPLAYER_URL` does not fall back
to the env file, it shadows it, and `config/multiplayer.ts` then takes its
`ws://localhost:8787` branch. An unset `${{ vars.X }}` in a workflow expands to
exactly that empty string — so a forgotten repository variable would silently
deploy a build that can never connect. A _non-empty_ environment variable still
overrides the file, which is how a one-off build against another relay works:

```bash
VITE_MULTIPLAYER_URL=wss://staging.example.com npm run build
```

## GitHub secrets/variables

Repo → **Settings → Secrets and variables → Actions**:

| Type         | Name                    | Value                                  |
| ------------ | ----------------------- | -------------------------------------- |
| Secret       | `CLOUDFLARE_API_TOKEN`  | "Edit Cloudflare Workers" scoped token |
| Secret       | `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami`                  |
| **Variable** | `VITE_CF_BEACON_TOKEN`  | Web Analytics site token (optional)    |

Both jobs authenticate non-interactively from the two `CLOUDFLARE_*` env vars; the
workflow needs no special GitHub `permissions:`.

The API token must be able to write Workers **and** manage the zone's DNS —
`custom_domain` entries make wrangler create the proxied records. The "Edit
Cloudflare Workers" template covers both.

## Deploying by hand

```bash
npx wrangler login    # once
npm run deploy        # tests → build → static site → relay → smoke test
```

`npm run deploy` is `scripts/deploy.sh`. It runs the same steps as CI, in the same
order, plus two checks CI does not need: it verifies wrangler is authenticated
_before_ spending minutes on a build, and it warns when the tree is dirty or the
branch is not `main` — a hand-deploy ships the working tree, not the commit. It
finishes by curling both hostnames, `/health`, and one path that must **not** exist
(`/.tmp/...`), so a green upload that is nonetheless not serving fails loudly.
`--skip-tests` redeploys an already-tested tree.

The individual steps still work on their own, which is what CI uses:

```bash
npm run build
npm run deploy -w client    # uploads client/dist
npm run deploy -w server    # the relay
```

## Zone settings (dashboard only)

These are not in any config file and wrangler cannot set them:

- **SSL/TLS → Edge Certificates → Always Use HTTPS** — on. Without it, plain
  `http://` is served as `200` instead of redirecting.
- **SSL/TLS → Overview** — the encryption mode is moot here (there is no origin
  behind Cloudflare; both hostnames terminate at Workers), but `Full (strict)` is
  the right default if an origin is ever added.

## Verify

Push to `main` → two green jobs in Actions. Then:

```bash
curl -sI https://drone-directive.space/ | head -1
curl -s  https://relay.drone-directive.space/health          # -> ok
```

Open the site, **Online (2P)** → Host, then Join by code in a second tab — it
should connect through the production relay.

## Shipping a protocol bump

`PROTOCOL_VERSION` is checked at connect time and a mismatch is a hard reject, so
**the relay and the static client must ship together.** Both jobs run off the same
push, which is what makes that safe — if you ever gate the relay deploy on
`paths:` (see Optional, below), a schema-only change could ship the client without
the relay and every connect would fail with `version-mismatch`.

What a player with the _previous_ bundle now sees is no longer a raw relay
string. The build emits `/version.json` (`{ build, protocol }` — the SHA from
`GITHUB_SHA`, the number parsed straight out of `protocol/src/index.ts`), served
`no-store`, and the title screen compares it against what was compiled in:

- a different `build` → a dismissible "new version" strip, with a Reload button;
- a different `protocol` → a blocking strip, and the lobby stops offering Create
  and Join at all rather than failing on connect.

The relay stays the authority — `GameApp` latches the same block when the relay
answers `VersionMismatch`, which is what covers the minute a deploy has shipped
one half and not the other, and the desktop app, whose bundled manifest can only
ever agree with itself. See `client/src/config/version.ts`. `version.json` is
emitted by the build, so there is nothing to commit and nothing to keep in sync
by hand.

A change that adds a Durable Object class (as chat's `Chat` did) also needs a new
`[[migrations]]` tag in `server/wrangler.toml`; wrangler applies it on deploy, and
without it the binding has nothing to bind to. Migration tags are append-only —
never edit a tag that has already been deployed.

## Publishing the client to GitHub Packages

A third, independent shipping channel, for the desktop shell
(`andriy-fs/drone-directive-desktop`, see `.docs/internal/todo/desktop-electron.md`):
the built game published as an npm package of **static assets**, so a shell can
install a pinned version and copy `dist/` into its bundle.

`.github/workflows/publish-client.yml` runs it on a `v*` tag — never on a push to
`main`. The website moves every commit; a desktop build must be able to sit on a
version it was tested against.

### What is published, and why not `client/` itself

`client/` is `private` and depends on four workspace siblings by `"*"`, which no
registry can resolve. It is also unnecessary: `vite build` has already inlined all
four into the bundle. So `scripts/pack-dist.mjs` stages `client/dist` plus a
**generated** manifest with zero dependencies into `client/.pack`, and that is what
`npm publish` uploads (~27 MB, ~340 files). There is no entry point — nothing
`import`s the package.

```bash
npm run pack:client       # build + stage into client/.pack, then inspect it
npm run publish:client    # the same, then `npm publish ./client/.pack`
```

The staging step refuses to package a bundle containing `ws://localhost:8787`
(`--allow-dev-relay` overrides). On the website the dev relay is merely wrong; in a
desktop build in a user's hands it cannot be fixed without a new release. The
workflow therefore passes no `VITE_MULTIPLAYER_URL` either, for the reason given in
"Where the relay hostname comes from".

### The name is forced

The package is **`@andriy-fs/drone-directive-client`**, not `@drone-directive/client`.
GitHub Packages only accepts a scope matching the owner of the repository it is
published from. Renaming the workspace to match was the alternative and is worse:
that name is load-bearing across six workspaces' imports, while only the published
artifact needs the new one. Publishing under `@drone-directive` would require a
GitHub _organisation_ of that name owning this repo.

### Auth

Pushing needs nothing new: `permissions: packages: write` lets the built-in
`GITHUB_TOKEN` publish, and `actions/setup-node` writes the `.npmrc` — which is why
the repo has none of its own.

**Installing does need a token, even though the package is public.** GitHub Packages
has no anonymous npm read. A consumer needs, at its repo root:

```
@andriy-fs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

with `NODE_AUTH_TOKEN` set to a classic PAT with `read:packages` — locally _and_ in
its CI, since a repository's own `GITHUB_TOKEN` cannot read another repository's
packages. That cost is the whole argument against this channel and for a plain
`github:andriy-fs/drone-directive#v0.3.0` git dependency; it is worth paying when the
game repo goes private, or to stop every consumer install from cloning and rebuilding
the entire monorepo.

### Cutting a version

```bash
npm version 1.0.1              # bumps the root package.json and tags it
git push origin main --follow-tags
```

The published version is the **root** `package.json`'s — the number `npm version`
bumps and tags. Every workspace's own version is inert and stays where it is. CI
refuses the publish if the tag and the root version disagree: a published version
is immutable, so the wrong number cannot be taken back.

## Web Analytics (optional)

Cloudflare dashboard → **Analytics & Logs → Web Analytics** → _Add a site_ with
hostname `drone-directive.space`. Copy the `token` out of the snippet it shows and
store it as the `VITE_CF_BEACON_TOKEN` **Variable** (not a secret — the token is
public in the page source anyway).

The build injects the beacon into `index.html` only when that variable is set
(`cloudflareWebAnalytics` in `client/vite.config.ts`), so local builds and the dev
server never report. The beacon uses no cookies, no `localStorage` and no
fingerprinting, so it needs no consent banner — keep it that way if you extend it.

## Optional

- **Redirect `www` to the apex.** Both names currently serve the game as separate
  `custom_domain` entries. To canonicalise, drop the `www` entry from
  `client/wrangler.toml` and add a **Redirect Rule** in the dashboard (Rules →
  Redirect Rules) — that needs a proxied placeholder DNS record for `www`.
- **Deploy the relay only when it changed.** Every push currently redeploys it
  (idempotent). To scope it, gate `deploy-worker` on paths — `server/**` and
  `protocol/**` are the whole of it: the relay depends on `protocol` and nothing
  else, not `types`, not `net`, which are client-side concerns. Read the protocol
  warning above first.
