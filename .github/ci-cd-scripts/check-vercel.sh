#!/bin/bash
set -euo pipefail

if [ -z "${VERCEL_BASE_URL:-}" ]; then
  echo "VERCEL_BASE_URL is required"
  exit 1
fi

if [ -z "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]; then
  echo "VERCEL_AUTOMATION_BYPASS_SECRET is required"
  exit 1
fi

curl --fail --silent --show-error \
  --header "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}" \
  --output /dev/null \
  --write-out "URL: $VERCEL_BASE_URL\nHTTP status code: %{http_code}\n" \
  "$VERCEL_BASE_URL"
