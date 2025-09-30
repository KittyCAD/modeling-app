#!/bin/bash
if [ -z "$WINDOWS_CERTIFICATE_THUMBPRINT" ]; then
  echo "Error: Please set WINDOWS_CERTIFICATE_THUMBPRINT."
  exit 1
fi

CONFIG_FILE="electron-builder.yml"
yq -i '.win.signtoolOptions.certificateSha1 = env(WINDOWS_CERTIFICATE_THUMBPRINT)' $CONFIG_FILE
yq -i '.win.signtoolOptions.signingHashAlgorithms[0] = "sha256"' $CONFIG_FILE
yq -i '.win.signtoolOptions.publisherName = "ZOO CORPORATION"' $CONFIG_FILE
yq -i '.win.signtoolOptions.certificateSubjectName = "ZOO CORPORATION"' $CONFIG_FILE
