#!/bin/bash
set -euo pipefail

# Install vector
curl --proto '=https' --tlsv1.2 -sSfL https://sh.vector.dev | bash -s -- -y

# Create vector directory
mkdir -p /tmp/vector

# Copy and configure vector.toml
cp .github/workflows/vector.toml /tmp/vector.toml
sed -i "s#GITHUB_WORKFLOW#${GITHUB_WORKFLOW}#g" /tmp/vector.toml
sed -i "s#GITHUB_REPOSITORY#${GITHUB_REPOSITORY}#g" /tmp/vector.toml
sed -i "s#GITHUB_SHA#${GITHUB_SHA}#g" /tmp/vector.toml
sed -i "s#GITHUB_REF_NAME#${GITHUB_REF_NAME}#g" /tmp/vector.toml
# sed -i "s#GH_ACTIONS_AXIOM_TOKEN#${GH_ACTIONS_AXIOM_TOKEN}#g" /tmp/vector.toml

# Display configured toml file
cat /tmp/vector.toml

# Start vector in background
${HOME}/.vector/bin/vector --config /tmp/vector.toml &
