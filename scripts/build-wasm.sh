#!/bin/bash
set -euo pipefail

rm -rf rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
rm -rf rust/kcl-lib/bindings

cargo_target_wasm32_unknown_unknown_rustflags='--cfg getrandom_backend="wasm_js"'
cd rust
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="$cargo_target_wasm32_unknown_unknown_rustflags" \
    wasm-pack build kcl-wasm-lib --release --target web --out-dir pkg
cargo test -p kcl-lib --features artifact-graph export_bindings
cd ..

cp rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm public
npm run fmt
