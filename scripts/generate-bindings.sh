#!/usr/bin/env bash
# Regenerates the gitignored TypeScript-facing bindings from the Rust types.
# This is intentionally separate from the Wasm build so normal app builds do
# not compile kcl-lib for both the Wasm and native targets.
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf rust/kcl-lib/bindings rust/kcl-lsp-server/bindings
cd rust
cargo test -p kcl-lib --features artifact-graph export_bindings
cargo test -p kcl-language-server export_bindings

# The app consumes one canonical bindings directory. The language-server types
# are generated beside their new crate, then merged with kcl-lib's bindings.
# Do not replace a full kcl-lib binding with the language server's smaller
# foreign-type shim (for example, ModelingCmd.ts generated for UnitLength).
rsync -a --ignore-existing kcl-lsp-server/bindings/ kcl-lib/bindings/
rm -rf kcl-lsp-server/bindings
