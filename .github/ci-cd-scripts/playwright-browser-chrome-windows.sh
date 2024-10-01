if [[ ! -f "test-results/.last-run.json" ]]; then
    # if no last run artifact, than run plawright normally
    echo "run playwright normally"
    yarn playwright test --project="Google Chrome" --config=playwright.ci.config.ts --shard=$1/$2 --grep-invert="@snapshot|@electron|@skipWin" || true
    # # send to axiom
    node playwrightProcess.mjs | tee /tmp/github-actions.log > /dev/null 2>&1
fi

retry=1
max_retrys=4

# retry failed tests, doing our own retries because using inbuilt playwright retries causes connection issues
while [[ $retry -le $max_retrys ]]; do
    if [[ -f "test-results/.last-run.json" ]]; then
        failed_tests=$(jq '.failedTests | length' test-results/.last-run.json)
        if [[ $failed_tests -gt 0 ]]; then
            echo "retried=true" >>$GITHUB_OUTPUT
            echo "run playwright with last failed tests and retry $retry"
            yarn playwright test --project="Google Chrome" --config=playwright.ci.config.ts --last-failed --grep-invert="@snapshot|@electron|@skipWin" || true
            # send to axiom
            node playwrightProcess.mjs | tee /tmp/github-actions.log > /dev/null 2>&1
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
    failed_tests=$(jq '.failedTests | length' test-results/.last-run.json)
    if [[ $failed_tests -gt 0 ]]; then
        # if it still fails after 3 retrys, then fail the job
        exit 1
    fi
fi
exit 0
