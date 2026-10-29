#!/usr/bin/env bash
set -euo pipefail

# E2E fault injection ONLY. NEVER use this feature/package in shipped builds.
# Keep every generated artifact separate from the regular pkg/public bundles.
cd "$(dirname "$0")/.."
(
  cd rust
  wasm-pack build kcl-wasm-lib --release --no-opt --target=web \
    --out-dir=../../.vite/wasm-recovery/pkg --scope=kittycad \
    --features=e2e-fault-injection
)
# Serve a prebuilt app, not an optimizer-reloading development server.
env -u VITE_ZOO_API_TOKEN -u VITE_KITTYCAD_API_TOKEN -u KITTYCAD_DEV_TOKEN \
  VITE_ZOO_BASE_DOMAIN=dev.zoo.dev node node_modules/vite/bin/vite.js build \
  --config=vite.wasm-recovery.config.ts --mode=development
mkdir -p .vite/wasm-recovery/renderer/wasm-recovery
cp .vite/wasm-recovery/pkg/kcl_wasm_lib_bg.wasm \
  .vite/wasm-recovery/renderer/wasm-recovery/kcl_wasm_lib_bg.wasm
