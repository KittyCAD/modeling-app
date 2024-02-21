#!/bin/bash

if ! git diff-index --quiet HEAD --; then
  echo "Please stash uncommitted changes before running release script"
  exit 1
fi

git checkout main
git pull

# Get the latest semver tag from git
latest_tag=$(git tag -l 'v*' --sort=-v:refname | head -n 1)

# Print the latest semver tag
echo "Latest semver tag: $latest_tag"

# Function to bump version numbers
bump_version() {
  local version=$1
  local bump_type=$2
  local major=$(echo $version | cut -d '.' -f 1 | sed 's/v//')
  local minor=$(echo $version | cut -d '.' -f 2)
  local patch=$(echo $version | cut -d '.' -f 3)

  case "$bump_type" in
    major)
      major=$((major + 1))
      minor=0
      patch=0
      ;;
    minor)
      minor=$((minor + 1))
      patch=0
      ;;
    *)
      patch=$((patch + 1))
      ;;
  esac

  echo "v${major}.${minor}.${patch}"
}

# Determine the type of bump based on the argument
bump_type=${1:-patch}

# Bump the version
new_version=$(bump_version $latest_tag $bump_type)

# Print the new semver tag
echo "New semver tag: $new_version"
new_version_number=${new_version:1}
echo "New version number without 'v': $new_version_number"


git checkout -b "cut-release-$new_version"

echo "$(jq --arg v "$new_version_number" '.version=$v' package.json --indent 2)" > package.json
echo "$(jq --arg v "$new_version_number" '.package.version=$v' src-tauri/tauri.conf.json --indent 2)" > src-tauri/tauri.conf.json

git add package.json src-tauri/tauri.conf.json
git commit -m "Cut release $new_version"

echo ""
echo "Versions has been bumped in relevant json files, a branch has been created and committed to."
echo ""
echo "What's left for you to do is, push the branch and make the release PR."
echo ""
