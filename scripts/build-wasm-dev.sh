#!/usr/bin/env bash
set -euo pipefail

rm -rf rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
rm -rf rust/kcl-lib/bindings

cd rust
wasm-pack build kcl-wasm-lib --dev --target web --out-dir pkg
cargo test -p kcl-lib --features artifact-graph export_bindings
cd ..

cp rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm public
npm run fmt
