#!/bin/bash

# Usage: echo "$(scripts/get-changelog-from-releases.sh)" > CHANGELOG.md

# max number of releases to pull
limit=1000

cat << EOF
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 

### Changed

-

### Fixed

-

EOF

tags=$(gh release list --json tagName --limit $limit | jq -r '.[].tagName') 
for tag in $(echo $tags); do
    # TODO: this should really be one call only
    release_body=$(gh release view $tag --json body | jq -r '.body')
    release_date=$(gh release view $tag --json publishedAt | jq -r '.publishedAt')
    echo "## [$tag] - ${release_date:0:10}"
    echo
    ## Bring headers down two levels
    body=$(echo "$release_body" | sed -e 's/# /### /')
    echo "$body"
    echo
done
