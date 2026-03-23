#!/usr/bin/env bash
set -euo pipefail

# Quiet alternatives to pushd and popd.
pushd() { builtin pushd "$@" > /dev/null; }
# shellcheck disable=SC2120
popd()  { builtin popd  "$@" > /dev/null; }

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

succeeded=0
failed=0

# Find all .kcl files in the public/kcl-samples directory. Keep paths relative
# to that directory so that we can output the migrated files in the same
# directory structure.
pushd public/kcl-samples/
mapfile -d '' -t files < <(find . -name "*.kcl" -type f -print0)
popd

output_dir="public/sketch-solve-samples"

# Delete existing files so that removed samples get deleted.
# rm -rf "$output_dir"

for file in "${files[@]}"; do
  # Ensure output directory exists.
  echo "Migrating: $file"
  out_file="$output_dir/$file"
  out_dir=$(dirname "$out_file")
  mkdir -p "$out_dir"

  # Don't use cargo run to avoid the extra output.
  set +e
  if "$transpile_bin" "public/kcl-samples/$file" > "$out_file"; then
    ((succeeded++))
  else
    ((failed++))
  fi
  set -e
  # Delete the output file if it's empty.
  if [[ ! -s "$out_file" ]]; then
    rm "$out_file"
  fi
done

echo "Succeeded: $succeeded"
echo "Failed: $failed"
