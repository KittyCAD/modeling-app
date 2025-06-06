#!/bin/bash

# bash strict mode
set -euo pipefail

if [[ ! -f "test-results/.last-run.json" ]]; then
    # If no last run artifact, than run Playwright normally
    echo "run playwright normally"
    if [[ "$3" == *ubuntu* ]]; then
        xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- npm run test:e2e:desktop -- --shard=$1/$2 || true
    elif [[ "$3" == *windows* ]]; then
        npm run test:e2e:desktop -- --grep=@windows --shard=$1/$2 || true
    elif [[ "$3" == *macos* ]]; then
        npm run test:e2e:desktop -- --grep=@macos --shard=$1/$2 || true
    else
        echo "Do not run Playwright. Unable to detect os runtime."
        exit 1
    fi
    # Log failures for Axiom to pick up
    node playwrightProcess.mjs > /tmp/github-actions.log
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
                npm run test:e2e:desktop -- --grep=@windows --last-failed || true
            elif [[ "$3" == *macos* ]]; then
                npm run test:e2e:desktop -- --grep=@macos --last-failed || true
            else
                echo "Do not run playwright. Unable to detect os runtime."
                exit 1
            fi
            # Log failures for Axiom to pick up
            node playwrightProcess.mjs > /tmp/github-actions.log
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
