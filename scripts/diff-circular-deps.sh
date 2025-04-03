#!/bin/bash
set -euo pipefail

yarn circular-deps | sed '$d' | grep -v '^yarn run' > /tmp/circular-deps.txt
diff --ignore-blank-lines -w /tmp/circular-deps.txt ./known-circular.txt
