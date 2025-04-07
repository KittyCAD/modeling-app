#!/bin/bash
set -euo pipefail

# Install vector
brew tap vectordotdev/brew && brew install vector

# Configure vector
mkdir -p /tmp/vector
cp .github/workflows/vector.toml /tmp/vector.toml
sed -i '' "s#OS_NAME#${OS_NAME}#g" /tmp/vector.toml
sed -i '' "s#GITHUB_WORKFLOW#${GITHUB_WORKFLOW}#g" /tmp/vector.toml
sed -i '' "s#GITHUB_REPOSITORY#${GITHUB_REPOSITORY}#g" /tmp/vector.toml
sed -i '' "s#GITHUB_SHA#${GITHUB_SHA}#g" /tmp/vector.toml
sed -i '' "s#GITHUB_REF_NAME#${GITHUB_REF_NAME}#g" /tmp/vector.toml
sed -i '' "s#GH_ACTIONS_AXIOM_TOKEN#${GH_ACTIONS_AXIOM_TOKEN}#g" /tmp/vector.toml

# Display settings
echo
echo 'Vector config:'
cat /tmp/vector.toml
echo

# Start in the background
$(brew --prefix)/opt/vector/bin/vector --config /tmp/vector.toml &
