#!/bin/bash
set -euo pipefail

if [ -z "${TAB_API_URL:-}" ] || [ -z "${TAB_API_KEY:-}" ]; then
    exit 0
fi

project="https://github.com/KittyCAD/modeling-app"
branch="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
commit="${CI_COMMIT_SHA:-${GITHUB_SHA:-}}"

echo "Uploading batch results"
curl --silent --request POST \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --form "project=${project}" \
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
  --form "GITHUB_SHA=${GITHUB_SHA:-}" \
  --form "GITHUB_WORKFLOW=${GITHUB_WORKFLOW:-}" \
  --form "RUNNER_ARCH=${RUNNER_ARCH:-}" \
  ${TAB_API_URL}/api/results/bulk

echo
echo "Sharing updated report"
curl --silent --request POST \
  --header "Content-Type: application/json" \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --data "{
    \"project\": \"${project}\",
    \"branch\": \"${branch}\",
    \"commit\": \"${commit}\"
  }" \
  ${TAB_API_URL}/api/share
