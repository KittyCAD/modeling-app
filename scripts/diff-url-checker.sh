#!/bin/bash
set -euo pipefail

npm run url-checker | sed '$d' > /tmp/known-urls.txt
diff --ignore-blank-lines -w /tmp/known-urls.txt ./known-urls.txt
