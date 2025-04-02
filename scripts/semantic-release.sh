#!/bin/bash
set -euo pipefail

# Fetch the latest release tag
git fetch --all --tags
latest_tag=$(git tag --sort=-v:refname | grep "^v[0-9]" | head -n 1)

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
bump_type=${1:-minor}

# Bump the version
new_version=$(bump_version $latest_tag $bump_type)

# Print the new semver tag
# Example output v0.27.1
# Yes it will include the v at the start
echo $new_version
