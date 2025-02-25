#!/bin/bash

# Set the repository owner and name
REPO_OWNER="KittyCAD"
REPO_NAME="modeling-app"
WORKFLOW_NAME="build-and-store-wasm.yml"
ARTIFACT_NAME="wasm-bundle"

# Fetch the latest completed workflow run ID for the specified workflow
# RUN_ID=$(gh api repos/$REPO_OWNER/$REPO_NAME/actions/workflows/$WORKFLOW_NAME/runs --paginate --jq '.workflow_runs[] | select(.status=="completed") | .id' | head -n 1)
RUN_ID=$(gh api repos/$REPO_OWNER/$REPO_NAME/actions/workflows/$WORKFLOW_NAME/runs --paginate --jq '.workflow_runs[] | select(.status=="completed" and .conclusion=="success") | .id' | head -n 1)

echo $RUN_ID

# Check if a valid RUN_ID was found
if [ -z "$RUN_ID" ]; then
  echo "Failed to find a workflow run for $WORKFLOW_NAME."
  exit 1
fi

gh run download $RUN_ID --repo $REPO_OWNER/$REPO_NAME --name $ARTIFACT_NAME --dir ./src/wasm-lib/pkg

cp src/wasm-lib/pkg/wasm_lib_bg.wasm public
echo "latest wasm copied to public folder"
