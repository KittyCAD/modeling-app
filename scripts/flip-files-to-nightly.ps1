$env:VERSION=(Get-Date -Format "yy.M.d")
$env:COMMIT=$(git rev-parse --short HEAD)
$env:PRODUCT_NAME="Zoo Modeling App (Nightly)"

# package.json
yq -i '.version = env(VERSION)' -p=json -o=json package.json
yq -i '.productName = env(PRODUCT_NAME)' -p=json -o=json package.json
yq -i '.name = ""zoo-modeling-app-nightly""' -p=json -o=json package.json

# electron-builder.yml
yq -i '.publish[0].url = ""https://dl.zoo.dev/releases/modeling-app/nightly""' electron-builder.yml
yq -i '.appId = ""dev.zoo.modeling-app-nightly""' electron-builder.yml
yq -i '.nsis.include = ""./scripts/installer-nightly.nsh""' electron-builder.yml

# Release notes
echo "Nightly build $VERSION (commit $COMMIT)" > release-notes.md

# icons
cp assets/icon-nightly.png assets/icon.png
cp assets/icon-nightly.ico assets/icon.ico
