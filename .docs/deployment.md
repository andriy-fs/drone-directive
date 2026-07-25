# Deploy (UI + relay Worker on push to `main`)

How to auto-deploy **both** halves of the game on every push to `main`:

- **UI** → GitHub Pages (already wired in `.github/workflows/deploy.yml`).
- **Relay Worker** (`@drone-directive/server`) → Cloudflare, via `wrangler deploy`.

The two deploys are independent. They're linked only by one build-time value: the
UI is built with `VITE_MULTIPLAYER_URL` pointing at the Worker's URL. That URL is
stable (`wss://drone-directive-relay.<SUBDOMAIN>.workers.dev`), so the jobs can run
in parallel — no ordering dependency.

## Step 1 — Cloudflare (one-time)

1. **Do one manual deploy** — it creates the Worker, enables the `workers.dev`
   subdomain, and prints the exact URL:

   ```bash
   npx wrangler login
   npm run deploy -w server
   ```

   The output contains `https://drone-directive-relay.<SUBDOMAIN>.workers.dev` —
   note `<SUBDOMAIN>`. (Also confirm Durable Objects are enabled on the account —
   the free plan needs SQLite-backed DOs, which is what `server/wrangler.toml`
   declares.)

2. **API token**: Cloudflare dashboard → My Profile → **API Tokens** → Create
   Token → **"Edit Cloudflare Workers"** template → scope it to your account →
   create and copy.

3. **Account ID**: dashboard → Workers & Pages (right column), or `npx wrangler whoami`.

## Step 2 — GitHub secrets/variables

Repo → **Settings → Secrets and variables → Actions**:

| Type         | Name                     | Value                                                       |
| ------------ | ------------------------ | ----------------------------------------------------------- |
| Secret       | `CLOUDFLARE_API_TOKEN`   | the token from step 1.2                                     |
| Secret       | `CLOUDFLARE_ACCOUNT_ID`  | the account id from step 1.3                                |
| **Variable** | `VITE_MULTIPLAYER_URL`   | `wss://drone-directive-relay.<SUBDOMAIN>.workers.dev`       |

The URL is not secret, so it lives under *Variables*. Note the `wss://` scheme and
no trailing path.

## Step 3 — `.github/workflows/deploy.yml` changes

**a)** Feed the Worker URL into the static build — add `env` to the "Build app" step
of the `build` job:

```yaml
      - name: Build app
        run: npm run build
        env:
          VITE_MULTIPLAYER_URL: ${{ vars.VITE_MULTIPLAYER_URL }}
```

**b)** Add a job that deploys the Worker (a sibling of `build` / `deploy`):

```yaml
  deploy-worker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm install
      - name: Deploy relay Worker
        run: npm run deploy -w server
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

`wrangler deploy` authenticates non-interactively from those two env vars — no
changes to the workflow's GitHub `permissions:` are needed (they gate the Pages
deploy only; the Worker uses the Cloudflare API token).

## Verify

Push to `main` → two green paths in Actions (Pages + worker). Open the deployed UI,
**Online (2P)** → Host, then Join by code in a second tab — it should connect
through the production relay.

## Optional

- **Deploy the Worker only when it changed.** Every push currently redeploys it
  (idempotent). To scope it, gate the `deploy-worker` job on paths — e.g. run the
  workflow with a `paths:` filter for `server/**` and `protocol/**`, or add an
  `if:` guard using `dorny/paths-filter`.
- **Custom domain / route** instead of `workers.dev`: add a `route`/`custom_domain`
  in `server/wrangler.toml` and set `VITE_MULTIPLAYER_URL` to `wss://<that-host>`.
