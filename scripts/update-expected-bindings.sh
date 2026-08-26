#!/usr/bin/env bash
# Copies the generated (gitignored) TypeScript-facing bindings into the
# committed rust/kcl-lib/expected-bindings/ directory so that changes to the
# TypeScript API surface show up as diffs of tracked files.
#
# Prerequisite: the bindings must already be generated
# (`npm run bindings:generate`). Use `npm run bindings:update` to regenerate
# and copy in one step.
set -euo pipefail

cd "$(dirname "$0")/.."

ts_rs_src=rust/kcl-lib/bindings
dest=rust/kcl-lib/expected-bindings

if [ ! -d "$ts_rs_src" ]; then
  echo "error: $ts_rs_src does not exist; run 'npm run bindings:generate' first" >&2
  exit 1
fi

rm -rf "$dest/ts-rs"
# ts-rs nests bindings for foreign-crate types in subdirectories (e.g.
# serde_json/JsonValue.ts), so copy the whole tree.
cp -R "$ts_rs_src" "$dest/ts-rs"
