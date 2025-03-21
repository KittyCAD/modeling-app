$REPO_OWNER = "KittyCAD"
$REPO_NAME = "modeling-app"
$WORKFLOW_NAME = "build-and-store-wasm.yml"
$ARTIFACT_NAME = "wasm-bundle"

# Fetch the latest completed workflow run ID for the specified workflow
$RUN_ID = (gh run list -w $WORKFLOW_NAME --repo $REPO_OWNER/$REPO_NAME --limit 1 --json databaseId -s completed --jq 'first | .databaseId') -join [Environment]::NewLine

$PKG_PATH="./rust/kcl-wasm-lib/pkg/"
rm -r $PKG_PATH/*
gh run download $RUN_ID --repo $REPO_OWNER/$REPO_NAME --name $ARTIFACT_NAME --dir $PKG_PATH
cp $PKG_PATH/kcl_wasm_lib_bg.wasm public
echo "latest wasm copied to public folder"
