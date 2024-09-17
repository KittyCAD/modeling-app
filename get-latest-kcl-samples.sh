#!/bin/bash

SAMPLES_FILE_NAME="kclSamplesArray.json"
SAMPLES_FILE_PATH="src/lib/$SAMPLES_FILE_NAME"

echo "Fetching latest KCL samples..."

# Get the non-hidden directories in the repository
SAMPLES_LIST=$(gh api repos/KittyCAD/kcl-samples/contents --jq \
    '[ .[] | select((.type == "dir") and (.name | startswith(".") | not)) | .name ]' \
)

# Copy that list of directories to a lib file
echo $SAMPLES_LIST > $SAMPLES_FILE_PATH