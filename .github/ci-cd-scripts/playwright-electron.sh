#!/bin/bash

# bash strict mode
set -euo pipefail

if [[ -f "test-results/.last-run.json" ]]; then
    # --last-failed cannot recover a global error, so an outer retry must run
    # the complete shard instead of reusing the saved test selection.
    saved_run_status=0
    node scripts/check-playwright-run.mjs --classify-for-outer-retry || saved_run_status=$?
    if [[ $saved_run_status -eq 2 ]]; then
        rm -f test-results/.last-run.json test-results/report.json
    elif [[ $saved_run_status -ne 0 ]]; then
        exit "$saved_run_status"
    fi
fi

if [[ ! -f "test-results/.last-run.json" ]]; then
    # If no last run artifact, than run Playwright normally
    echo "run playwright normally"
    if [[ "$3" == *ubuntu* ]]; then
        xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- npm run test:e2e:desktop -- --shard=$1/$2 || true
    elif [[ "$3" == *windows* ]]; then
        npm run test:e2e:desktop -- --grep=@windows --grep-invert=@web --shard=$1/$2 || true
    elif [[ "$3" == *macos* ]]; then
        npm run test:e2e:desktop -- --grep=@macos --grep-invert=@web --shard=$1/$2 || true
    else
        echo "Do not run Playwright. Unable to detect os runtime."
        exit 1
    fi
    # Log failures for Axiom to pick up
    node playwrightProcess.mjs > /tmp/github-actions.log
    node scripts/check-playwright-run.mjs
fi

retry=1
max_retries=1

# Retry failed tests, doing our own retries because using inbuilt Playwright retries causes connection issues
while [[ $retry -le $max_retries ]]; do
    if [[ -f "test-results/.last-run.json" ]]; then
        status=$(jq -r '.status' test-results/.last-run.json)
        if [[ "$status" == "failed" ]]; then
            echo "retried=true" >>$GITHUB_OUTPUT
            echo "run playwright with last failed tests and retry $retry"
            if [[ "$3" == *ubuntu* ]]; then
                xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- npm run test:e2e:desktop -- --last-failed || true
            elif [[ "$3" == *windows* ]]; then
                npm run test:e2e:desktop -- --grep=@windows --grep-invert=@web --last-failed || true
            elif [[ "$3" == *macos* ]]; then
                npm run test:e2e:desktop -- --grep=@macos --grep-invert=@web --last-failed || true
            else
                echo "Do not run playwright. Unable to detect os runtime."
                exit 1
            fi
            # Log failures for Axiom to pick up
            node playwrightProcess.mjs > /tmp/github-actions.log
            node scripts/check-playwright-run.mjs
            retry=$((retry + 1))
        else
            echo "retried=false" >>$GITHUB_OUTPUT
            exit 0
        fi
    else
        echo "retried=false" >>$GITHUB_OUTPUT
        exit 0
    fi
done

echo "retried=false" >>$GITHUB_OUTPUT

if [[ -f "test-results/.last-run.json" ]]; then
    status=$(jq -r '.status' test-results/.last-run.json)
    if [[ "$status" == "failed" ]]; then
        # If it still fails after retries, then fail the job
        exit 1
    fi
fi

exit 0
