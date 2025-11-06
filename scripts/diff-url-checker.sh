#!/usr/bin/env bash
set -euo pipefail

npm run url-checker > /tmp/urls.txt
diff --ignore-blank-lines -w /tmp/urls.txt ./scripts/known/urls.txt
