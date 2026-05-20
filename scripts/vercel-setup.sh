#!/usr/bin/env sh

set -eu

. ./scripts/load-rust-env.sh

if [ ! -f rust-toolchain.toml ] && [ -f rust/rust-toolchain.toml ]; then
  cp rust/rust-toolchain.toml rust-toolchain.toml
fi

cd rust
if ! rustup show active-toolchain >/dev/null 2>&1; then
  rustup toolchain install
fi
rustup target add wasm32-unknown-unknown
cd ..

if ! command -v wasm-pack >/dev/null 2>&1; then
  cargo install wasm-pack --locked
fi
