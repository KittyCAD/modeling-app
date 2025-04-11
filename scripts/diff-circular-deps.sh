#!/bin/bash
set -euo pipefail

npm run circular-deps | sed '$d' | grep -v '^npm' > /tmp/circular-deps.txt
diff --ignore-blank-lines -w /tmp/circular-deps.txt ./known-circular.txt
