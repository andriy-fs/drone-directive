#!/usr/bin/env bash
#
# Deploys both halves of the game to Cloudflare, in the order CI does it:
# tests, build, static site, relay Worker. Run from anywhere — `npm run deploy`
# at the repo root is the intended entry point.
#
# This is for hand-deploys; pushing to `main` already does the same thing via
# `.github/workflows/deploy.yml`. It exists because a hand-deploy has two failure
# modes CI does not: it can run against an unauthenticated wrangler after two
# minutes of building, and it ships the working tree rather than a clean checkout.
# Both are checked up front.
#
# Flags:
#   --skip-tests   go straight to the build (for redeploying an already-tested tree)
#
# See `.docs/deployment.md`.
set -euo pipefail

cd "$(dirname "$0")/.."

RUN_TESTS=1
for arg in "$@"; do
  case "$arg" in
    --skip-tests) RUN_TESTS=0 ;;
    *)
      echo "deploy: unknown flag '$arg' (expected --skip-tests)" >&2
      exit 2
      ;;
  esac
done

step() { printf '\n\033[1;36m▶ %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$1" >&2; }

# ---------------------------------------------------------------------------
# Preflight — fail before doing minutes of work, not after
# ---------------------------------------------------------------------------
step 'Preflight'

# `wrangler whoami` exits non-zero when there are no stored credentials and no
# CLOUDFLARE_API_TOKEN. Checking here turns a confusing failure at the last step
# into an actionable one at the first.
if ! npx --no-install wrangler whoami >/dev/null 2>&1; then
  echo "deploy: wrangler is not authenticated. Run 'npx wrangler login' (or set CLOUDFLARE_API_TOKEN)." >&2
  exit 1
fi
echo "  cloudflare: authenticated"

# Not a hard stop: deploying a work-in-progress tree is a legitimate thing to do
# on purpose. It just should never happen by accident, because what ships is the
# tree, not the commit — `client/public/.assetsignore` exists for exactly this.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  warn "working tree is dirty — deploying uncommitted changes"
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
[ "$branch" = 'main' ] || warn "on branch '$branch', not 'main'"

# ---------------------------------------------------------------------------
# Gate — mirrors the CI job, so a hand-deploy is not the weaker path
# ---------------------------------------------------------------------------
if [ "$RUN_TESTS" -eq 1 ]; then
  step 'Tests (net, chat, engine)'
  npm test
else
  warn 'skipping tests (--skip-tests)'
fi

# `npm run build` is `tsc -b && vite build`, so this type-checks too. The relay
# hostname comes from `client/.env.production` — do not pass it in here, see the
# warning in that file about empty values shadowing it.
step 'Build'
npm run build

# ---------------------------------------------------------------------------
# Deploy — two independent Workers, no ordering dependency between them
# ---------------------------------------------------------------------------
step 'Deploy static site'
npm run deploy -w client

step 'Deploy relay Worker'
npm run deploy -w server

# ---------------------------------------------------------------------------
# Smoke test — catches a green deploy that is nonetheless not serving
# ---------------------------------------------------------------------------
step 'Smoke test'
fail=0
check() {
  local label=$1 url=$2 want=$3
  local got
  # No `-f`: these assertions are about the status code, and `--fail` would make
  # curl exit non-zero on the 404 we are deliberately expecting. A genuine
  # transport failure still exits non-zero (and prints `000`), hence the fallback.
  got=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null) || got='ERR'
  if [ "$got" = "$want" ]; then
    printf '  \033[32m✓\033[0m %-14s %s\n' "$label" "$url"
  else
    printf '  \033[31m✗\033[0m %-14s %s (got %s, want %s)\n' "$label" "$url" "$got" "$want"
    fail=1
  fi
}

check 'site'     'https://drone-directive.space/'             200
check 'www'      'https://www.drone-directive.space/'         200
check 'relay'    'https://relay.drone-directive.space/health' 200
# The desktop shell's update check. A packaged app asks this on every launch, and a
# 404 here would be invisible from the website — nothing else calls it.
check 'desktop'  'https://relay.drone-directive.space/desktop/version' 200
# A 404 here is the pass: the sprite pipeline's scratch directory must not ship.
check 'no .tmp'  'https://drone-directive.space/.tmp/base-ai.png' 404

if [ "$fail" -ne 0 ]; then
  echo >&2
  echo "deploy: uploaded, but the smoke test failed — check the Cloudflare dashboard." >&2
  exit 1
fi

printf '\n\033[1;32m✓ Deployed\033[0m  https://drone-directive.space/\n\n'
