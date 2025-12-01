#!/usr/bin/env bash
base_dir="/releases/design-studio"
if [[ $1 = "--staging" ]]; then
    base_dir="/releases/design-studio/staging"
fi

echo "Invalidating json and yml files at $base_dir in the download bucket"
gcloud compute url-maps invalidate-cdn-cache dl-url-map --path="$base_dir/last_download.json" --async
gcloud compute url-maps invalidate-cdn-cache dl-url-map --path="$base_dir/latest-linux-arm64.yml" --async
gcloud compute url-maps invalidate-cdn-cache dl-url-map --path="$base_dir/latest-mac.yml" --async
gcloud compute url-maps invalidate-cdn-cache dl-url-map --path="$base_dir/latest.yml" --async
