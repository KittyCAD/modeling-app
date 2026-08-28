#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ ! -x node_modules/.bin/playwright ]]; then
  echo "Playwright dependencies are missing. Run: npm install" >&2
  exit 2
fi

if [[ -z "${VITE_ZOO_API_TOKEN:-}" && -n "${ZOO_API_TOKEN:-}" ]]; then
  export VITE_ZOO_API_TOKEN="$ZOO_API_TOKEN"
fi

has_token=false
if [[ -n "${VITE_ZOO_API_TOKEN:-}" || -n "${VITE_KITTYCAD_API_TOKEN:-}" ]]; then
  has_token=true
elif [[ -f .env.development.local ]] && grep -Eq '^[[:space:]]*VITE_(ZOO|KITTYCAD)_API_TOKEN=.+' .env.development.local; then
  has_token=true
fi

if [[ "$has_token" != true ]]; then
  echo "Staging authentication is missing. Export VITE_ZOO_API_TOKEN (or ZOO_API_TOKEN) or add VITE_ZOO_API_TOKEN to .env.development.local." >&2
  exit 2
fi

run_id="$(date -u +%Y%m%dT%H%M%SZ)"
run_dir="${PLAYWRIGHT_GUI_FUZZ_OUTPUT_DIR:-$repo_root/test-results/gui-fuzz/$run_id}"
base_url="${VERCEL_BASE_URL:-https://app.dev.zoo.dev}"
spec="${ZDS_GUI_FUZZ_SPEC:-e2e/playwright/gui-fuzz-point-click.spec.ts}"

if [[ "$spec" != e2e/playwright/*.spec.ts || ! -f "$spec" ]]; then
  echo "Invalid GUI fuzz spec: $spec" >&2
  exit 2
fi

echo "Zoo GUI fuzz target: $base_url"
echo "Scenario: $spec"
echo "Run output: $run_dir"

TARGET=web \
NODE_ENV=development \
VERCEL_BASE_URL="$base_url" \
PLAYWRIGHT_GUI_FUZZ_OUTPUT_DIR="$run_dir" \
  node_modules/.bin/playwright test \
    --config=playwright.gui-fuzz.config.ts \
    "$spec" \
    "$@"
