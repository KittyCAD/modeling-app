#!/usr/bin/env bash
set -euo pipefail

rm -rf rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
rm -rf rust/kcl-lib/bindings

cd rust

wasm_pack_args=(build kcl-wasm-lib --release --target=web --out-dir=pkg --scope=kittycad)
if [ "${KCL_WASM_PUBLISH:-}" = "1" ]; then
  commit_hash=$(git rev-parse --short HEAD)
  wasm_pack_args+=(--out-name="kcl_wasm_lib_$commit_hash")
fi
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  wasm_pack_args+=(--no-opt)
fi
wasm-pack "${wasm_pack_args[@]}"

cp -R kcl-lib/expected-bindings/ts-rs kcl-lib/bindings

if [ "${KCL_WASM_PUBLISH:-}" != "1" ]; then
  cp kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm ../public
fi
cp kcl-wasm-lib/README.md kcl-wasm-lib/pkg/README.md
