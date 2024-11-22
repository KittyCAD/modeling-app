#!/bin/bash

export VERSION=$(date +'%-y.%-m.%-d')
export COMMIT=$(git rev-parse --short HEAD)

# package.json
yarn files:set-version
echo "$(jq --arg name 'Zoo Modeling App (Nightly)' '.productName=$name' package.json --indent 2)" > package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/modeling-app/nightly"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-nightly"' electron-builder.yml

# Release notes
echo "Nightly build $VERSION (commit $COMMIT)" > release-notes.md

# icons
cp assets/icon-nightly.png assets/icon.png
cp assets/icon-nightly.ico assets/icon.ico
