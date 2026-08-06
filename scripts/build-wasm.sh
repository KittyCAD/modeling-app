#!/usr/bin/env bash
set -euo pipefail

cd rust

wasm_pack_args=(build kcl-wasm-lib --release --target web --out-dir pkg --scope kittycad)
if [ "${VERCEL_ENV:-}" = "preview" ]; then
  wasm_pack_args+=(--no-opt)
fi
wasm-pack "${wasm_pack_args[@]}"

if [ -n "${VERCEL:-}" ]; then
  cp -R kcl-lib/expected-bindings/ts-rs kcl-lib/bindings
else
  cargo test -p kcl-lib --features artifact-graph export_bindings
fi

cp kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm ../public
cp kcl-wasm-lib/README.md kcl-wasm-lib/pkg/README.md
