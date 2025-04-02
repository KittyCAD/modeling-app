#!/bin/bash
set -euo pipefail

yarn circular-deps | sed '$d' | grep -v '^yarn run' | tr -d '\n' > /tmp/circular-deps.txt
diff -w /tmp/circular-deps.txt ./known-circular.txt
