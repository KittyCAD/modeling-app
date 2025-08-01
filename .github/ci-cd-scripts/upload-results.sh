#!/bin/bash
set -euo pipefail

if [ -z "${TAB_API_URL:-}" ] || [ -z "${TAB_API_KEY:-}" ]; then
    echo "WARNING: TAB_API_URL and TAB_API_KEY must be set to analyze results"
    grep --quiet 'failures="0"' test-results/junit.xml
    exit 0
fi

project="${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}"
suite="${CI_SUITE:-unit}"
branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
commit="${CI_COMMIT_SHA:-${GITHUB_SHA:-}}"

echo "Uploading batch results:"
curl --silent --request POST \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --form "project=${project}" \
  --form "suite=${suite}" \
  --form "branch=${branch}" \
  --form "commit=${commit}" \
  --form "tests=@test-results/junit.xml" \
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
  ${TAB_API_URL}/api/results/bulk > test-results/tab.json
cat test-results/tab.json

echo
echo "Sharing updated report:"
curl --silent --request POST \
  --header "Content-Type: application/json" \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --data "{
    \"project\": \"${project}\",
    \"branch\": \"${branch}\",
    \"commit\": \"${commit}\"
  }" \
  ${TAB_API_URL}/api/share
echo

if [ -f "test-results/tab.json" ]; then
  grep --quiet '"block": false' test-results/tab.json
else
  grep --quiet 'failures="0"' test-results/junit.xml
fi
