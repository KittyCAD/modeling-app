#!/bin/bash

export VERSION=$(date +'%-y.%-m.%-d')
export TAG="nightly-v$VERSION"
export PREVIOUS_TAG=$(git describe --tags --match="nightly-v[0-9]*" --abbrev=0)
export COMMIT=$(git rev-parse --short HEAD)

# package.json
yarn files:set-version
PACKAGE=$(jq '.productName="Zoo Modeling App (Nightly)" | .name="zoo-modeling-app-nightly"' package.json --indent 2)
echo "$PACKAGE" > package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/modeling-app/nightly"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-nightly"' electron-builder.yml

# Release notes
./scripts/get-nightly-changelog.sh > release-notes.md

# icons
cp assets/icon-nightly.png assets/icon.png
cp assets/icon-nightly.ico assets/icon.ico
