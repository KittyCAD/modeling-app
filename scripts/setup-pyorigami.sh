#!/usr/bin/env bash
# Install the supported pure-Python backend without building Doodle's optional C++ extension.
set -euo pipefail

pyorigami_env="${1:-venv/pyorigami}"
pyorigami_source="$(mktemp -d)"
trap 'rm -rf "$pyorigami_source"' EXIT

git clone https://github.com/edvilme/pyOrigami.git "$pyorigami_source"
git -C "$pyorigami_source" checkout 35c33d70180a79a526d0476b3e218b145d1adf30
# Upstream setup.py unconditionally compiles the optional extension, which fails
# on macOS's missing malloc.h. Keep the Python package and its metadata intact.
cat > "$pyorigami_source/setup.py" <<'PY'
from setuptools import setup
setup()
PY

python3 -m venv "$pyorigami_env"
"$pyorigami_env/bin/python" -m pip install "$pyorigami_source" "libcst==1.9.0"
printf '\nLaunch Electron with ZDS_PYORIGAMI_PYTHON=%s/bin/python\n' "$(cd "$pyorigami_env" && pwd)"
