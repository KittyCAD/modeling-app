#!/usr/bin/env bash

yq -i '.releaseNotes = strenv(NOTES)' out/latest-linux-arm64.yml
yq -i '.releaseNotes = strenv(NOTES)' out/latest-linux.yml
yq -i '.releaseNotes = strenv(NOTES)' out/latest-mac.yml
yq -i '.releaseNotes = strenv(NOTES)' out/latest.yml

NEW_JSON=`jq --arg n "$NOTES" '.notes=$n' out/last_download.json --indent 2`
echo "$NEW_JSON" > out/last_download.json
