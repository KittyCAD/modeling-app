#!/bin/bash
set -euo pipefail

BRANCH="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
COMMIT="${CI_COMMIT_SHA:-${GITHUB_SHA:-}}"

# Upload the results to the Test Analysis Bot
curl --request POST \
  --header "X-API-Key: ${TAB_API_KEY}" \
  --form "project=https://github.com/KittyCAD/modeling-app" \
  --form "branch=${BRANCH}" \
  --form "commit=${COMMIT}" \
  --form "tests=@test-results/junit.xml" \
  https://tab.ngrok.app/api/results/bulk
