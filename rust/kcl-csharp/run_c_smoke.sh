#!/bin/zsh
set -euo pipefail

script_dir=$(cd "$(dirname "$0")" && pwd)
rust_dir=$(cd "$script_dir/.." && pwd)
target_dir="${CARGO_TARGET_DIR:-$rust_dir/target}/debug"
out_dir="${TMPDIR:-/tmp}/kcl-csharp-c-smoke"
binary="$out_dir/c_smoke"

mkdir -p "$out_dir"

cd "$rust_dir"
cargo build -p kcl-csharp

cc \
  -std=c11 \
  -Wall \
  -Wextra \
  -pedantic \
  -o "$binary" \
  "$script_dir/tests/c_smoke.c" \
  -L "$target_dir" \
  -Wl,-rpath,"$target_dir" \
  -lkcl_csharp

"$binary"
