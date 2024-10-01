if [[ ! -f "test-results/.last-run.json" ]]; then
    # if no last run artifact, than run plawright normally
    echo "run playwright normally"
    if [[ "$IS_UBUNTU" == "true" ]]; then
        xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- yarn test:playwright:electron:ubuntu || true
    else
        yarn test:playwright:electron:ubuntu || true
    fi
    # # send to axiom
    node playwrightProcess.mjs | tee /tmp/github-actions.log > /dev/null 2>&1
fi

retry=1
max_retrys=2

# retry failed tests, doing our own retries because using inbuilt playwright retries causes connection issues
while [[ $retry -le $max_retrys ]]; do
    if [[ -f "test-results/.last-run.json" ]]; then
        failed_tests=$(jq '.failedTests | length' test-results/.last-run.json)
        if [[ $failed_tests -gt 0 ]]; then
            echo "retried=true" >>$GITHUB_OUTPUT
            echo "run playwright with last failed tests and retry $retry"
            if [[ "$IS_UBUNTU" == "true" ]]; then
                xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- yarn test:playwright:electron:ubuntu -- --last-failed || true
            else
                yarn test:playwright:electron:ubuntu -- --last-failed || true
            fi
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
