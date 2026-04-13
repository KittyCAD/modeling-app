#!/usr/bin/env bash
set -euo pipefail

# Quiet alternatives to pushd and popd.
pushd() { builtin pushd "$@" >/dev/null; }
# shellcheck disable=SC2120
popd() { builtin popd "$@" >/dev/null; }

target_dir="${CARGO_TARGET_DIR:-target}"
if [[ "$target_dir" = /* ]]; then
  transpile_bin="$target_dir/release/transpile"
else
  transpile_bin="./rust/$target_dir/release/transpile"
fi

# Build once before touching the file system.
pushd rust/
cargo build --release --bin transpile -p kcl-lib
popd

output_dir="public/sketch-solve-samples"
ignore_file="$output_dir/transpile-ignore"
report_file="$output_dir/transpile-latest-report.txt"

"$transpile_bin" convert public/kcl-samples \
  -r \
  -k \
  --ignore-file "$ignore_file" \
  --out-dir "$output_dir" \
  --report-file "$report_file"
