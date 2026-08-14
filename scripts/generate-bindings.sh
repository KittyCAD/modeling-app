#!/usr/bin/env bash
# Regenerates the gitignored TypeScript-facing bindings from the Rust types.
# This is intentionally separate from the Wasm build so normal app builds do
# not compile kcl-lib for both the Wasm and native targets.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf rust/kcl-lib/bindings
cd rust
cargo test -p kcl-lib --features artifact-graph export_bindings
