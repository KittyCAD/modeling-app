#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  "AZURE_TRUSTED_SIGNING_ENDPOINT"
  "AZURE_TRUSTED_SIGNING_ACCOUNT_NAME"
  "AZURE_TRUSTED_SIGNING_CERT_PROFILE_NAME"
  "AZURE_TRUSTED_SIGNING_PUBLISHER_NAME"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "Error: Please set $var."
    exit 1
  fi
done

CONFIG_FILE="electron-builder.yml"
yq -i 'del(.win.signtoolOptions, .win.azureSignOptions)' "$CONFIG_FILE"
yq -i '.win.sign.type = "azure"' "$CONFIG_FILE"
yq -i '.win.sign.endpoint = env(AZURE_TRUSTED_SIGNING_ENDPOINT)' "$CONFIG_FILE"
yq -i '.win.sign.codeSigningAccountName = env(AZURE_TRUSTED_SIGNING_ACCOUNT_NAME)' "$CONFIG_FILE"
yq -i '.win.sign.certificateProfileName = env(AZURE_TRUSTED_SIGNING_CERT_PROFILE_NAME)' "$CONFIG_FILE"
yq -i '.win.sign.publisherName = env(AZURE_TRUSTED_SIGNING_PUBLISHER_NAME)' "$CONFIG_FILE"
yq -i '.win.sign.fileDigest = "SHA256"' "$CONFIG_FILE"
yq -i '.win.sign.timestampDigest = "SHA256"' "$CONFIG_FILE"
yq -i '.win.sign.timestampRfc3161 = "http://timestamp.acs.microsoft.com"' "$CONFIG_FILE"
