$COMMIT=$(git rev-parse --short HEAD)
$VERSION=$(Get-Date -Format "yy.M.d-staging.1-$COMMIT")
$PRODUCT_NAME="Zoo Design Studio (Staging)"

# package.json
yq -i '.version = env(VERSION)' -p=json -o=json package.json
yq -i '.productName = env(PRODUCT_NAME)' -p=json -o=json package.json
yq -i '.name = "zoo-modeling-app-staging"' -p=json -o=json package.json

# electron-builder.yml
yq -i '.publish[0].url = "https://dl.zoo.dev/releases/modeling-app/staging"' electron-builder.yml
yq -i '.appId = "dev.zoo.modeling-app-staging"' electron-builder.yml
yq -i '.nsis.include = "./scripts/installer-staging.nsh"' electron-builder.yml

# Release notes
echo "Staging build $VERSION (commit $COMMIT)" > release-notes.md

# icons
cp assets/icon-staging.png assets/icon.png
cp assets/icon-staging.ico assets/icon.ico
