#!/usr/bin/env bash

COMMIT=$(git rev-parse --short HEAD)
TITLE=$(git show -s --format=%s $COMMIT)

# package.json
PACKAGE=$(jq '.productName="Zoo Design Studio (Staging)" | .name="zoo-modeling-app-staging"' package.json --indent 2)
echo "$PACKAGE" > package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/design-studio/staging"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-staging"' electron-builder.yml
yq -i '.nsis.include = "./scripts/installer-staging.nsh"' electron-builder.yml

# Release notes
echo "[$TITLE](https://github.com/KittyCAD/modeling-app/commit/$COMMIT)" > release-notes.md

# icons
cp assets/icon-staging.png assets/icon.png
cp assets/icon-staging.ico assets/icon.ico
