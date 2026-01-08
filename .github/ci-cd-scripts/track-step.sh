#!/bin/bash
set -euo pipefail

if [ -z "${TAB_API_URL:-}" ] || [ -z "${TAB_API_KEY:-}" ]; then
    echo "WARNING: TAB_API_URL and TAB_API_KEY must be set to analyze results"
    exit 0
fi

project="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
suite="${CI_SUITE:-unit}"
branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
commit="${CI_COMMIT_SHA:-${GITHUB_SHA:-}}"
step="${CI_STEP}"

echo "Tracking step:"
curl --silent --request POST \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --form "project=${project}" \
  --form "suite=${suite}" \
  --form "branch=${branch}" \
  --form "commit=${commit}" \
  --form "step=${step}" \
  --form "CI_COMMIT_SHA=${CI_COMMIT_SHA:-}" \
  --form "CI_PR_NUMBER=${CI_PR_NUMBER:-}" \
  --form "GITHUB_BASE_REF=${GITHUB_BASE_REF:-}" \
  --form "GITHUB_EVENT_NAME=${GITHUB_EVENT_NAME:-}" \
  --form "GITHUB_HEAD_REF=${GITHUB_HEAD_REF:-}" \
  --form "GITHUB_REF_NAME=${GITHUB_REF_NAME:-}" \
  --form "GITHUB_REF=${GITHUB_REF:-}" \
  --form "GITHUB_RUN_ID=${GITHUB_RUN_ID:-}" \
  --form "GITHUB_SHA=${GITHUB_SHA:-}" \
  --form "GITHUB_WORKFLOW=${GITHUB_WORKFLOW:-}" \
  --form "RUNNER_ARCH=${RUNNER_ARCH:-}" \
  ${TAB_API_URL}/api/track
echo
