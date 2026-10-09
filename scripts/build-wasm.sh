#!/usr/bin/env bash
set -euo pipefail

rm -rf rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
rm -rf rust/kcl-lib/bindings

cd rust

COMMIT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo dev)

wasm_pack_args=(build kcl-wasm-lib --release --target=web --out-dir=pkg --out-name="kcl_wasm_lib_$COMMIT_HASH" --scope=kittycad)
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  wasm_pack_args+=(--no-opt)
fi
wasm-pack "${wasm_pack_args[@]}"

cp -R kcl-lib/expected-bindings/ts-rs kcl-lib/bindings

cp kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm ../public
cp kcl-wasm-lib/README.md kcl-wasm-lib/pkg/README.md
