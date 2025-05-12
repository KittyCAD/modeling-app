#!/bin/bash
set -euo pipefail

BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
COMMIT="${CI_COMMIT_SHA:-${GITHUB_SHA:-}}"

curl --request POST \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --form "project=https://github.com/KittyCAD/modeling-app" \
  --form "branch=${BRANCH}" \
  --form "commit=${COMMIT}" \
  --form "tests=@test-results/junit.xml" \
  ${TAB_API_URL}/api/results/bulk
