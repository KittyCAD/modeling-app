#!/bin/bash

# package.json
VERSION=$(date +'%-y.%-m.%-d') yarn files:set-version
PACKAGE=$(jq '.productName="Zoo Modeling App (Nightly)" | .name="zoo-modeling-app-nightly"' package.json --indent 2)
echo "$PACKAGE" > package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/modeling-app/nightly"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-nightly"' electron-builder.yml

# icons
cp assets/icon-nightly.png assets/icon.png
cp assets/icon-nightly.ico assets/icon.ico
