#!/bin/bash
set -euo pipefail

rm -rf rust/kcl-wasm-lib/pkg
mkdir -p rust/kcl-wasm-lib/pkg
rm -rf rust/kcl-lib/bindings

cd rust
export RUSTFLAGS='--cfg getrandom_backend="wasm_js"'
wasm-pack build kcl-wasm-lib --release --target web --out-dir pkg
export RUSTFLAGS=''
cargo test -p kcl-lib export_bindings
cd ..

cp rust/kcl-wasm-lib/pkg/kcl_wasm_lib_bg.wasm public
yarn fmt
