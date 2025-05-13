#!/bin/bash

COMMIT=$(git rev-parse --short HEAD)
TITLE=$(git show -s --format=%s $COMMIT)

# package.json
PACKAGE=$(jq '.productName="Zoo Design Studio (Nightly)" | .name="zoo-modeling-app-nightly"' package.json --indent 2)
echo "$PACKAGE" > package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/modeling-app/nightly"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-nightly"' electron-builder.yml
yq -i '.nsis.include = "./scripts/installer-nightly.nsh"' electron-builder.yml

# Release notes
echo "[$TITLE](https://github.com/KittyCAD/modeling-app/commit/$COMMIT)" > release-notes.md

# icons
cp assets/icon-nightly.png assets/icon.png
cp assets/icon-nightly.ico assets/icon.ico
