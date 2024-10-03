# bash strict mode
set -euo pipefail

if [[ ! -f "test-results/.last-run.json" ]]; then
    # if no last run artifact, than run plawright normally
    echo "run playwright normally"
        if [[ "$1" == "ubuntu-latest" ]]; then
            xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- yarn test:playwright:electron:ubuntu || true
        elif [[ "$1" == "windows-latest" ]]; then
            yarn test:playwright:electron:windows || true
        elif [[ "$1" == "macos-14" ]]; then
            yarn test:playwright:electron:macos || true
        else
            echo "Do not run playwright. Unable to detect os runtime."
            exit 1
        fi
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
            if [[ "$1" == "ubuntu-latest" ]]; then
                xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" -- yarn test:playwright:electron:ubuntu -- --last-failed || true
            elif [[ "$1" == "windows-latest" ]]; then
                yarn test:playwright:electron:windows -- --last-failed || true
            elif [[ "$1" == "macos-14" ]]; then
                yarn test:playwright:electron:macos -- --last-failed || true
            else
                echo "Do not run playwright. Unable to detect os runtime."
                exit 1
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
