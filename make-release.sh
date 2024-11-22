#!/bin/bash

if ! git diff-index --quiet HEAD --; then
  echo "Please stash uncommitted changes before running release script"
  exit 1
fi

git checkout main
git pull
git fetch --all

# Get the latest semver tag from git
latest_tag=$(jq -r '.version' package.json)
latest_tag="v$latest_tag"

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

VERSION=$new_version_number yarn json:set-version

git add package.json
git commit -m "Cut release $new_version"

echo ""
echo "Versions has been bumped in relevant json files, a branch has been created and committed to."
echo ""
echo "What's left for you to do is, push the branch and make the release PR."
echo ""

echo "Suggested changelog:"
echo "\`\`\`"
echo "## What's Changed"
git log $(git describe --tags --match="v[0-9]*" --abbrev=0)..HEAD --oneline --pretty=format:%s | grep -v Bump | grep -v 'Cut release v' | awk '{print "* "toupper(substr($0,0,1))substr($0,2)}'
echo ""
echo "**Full Changelog**: https://github.com/KittyCAD/modeling-app/compare/${latest_tag}...${new_version}"
echo "\`\`\`"
echo "and would recommend removing ones that aren't related to the product (eg. CI changes)"
