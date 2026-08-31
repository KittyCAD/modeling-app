#!/usr/bin/env bash
# Build bevy-zoo's embeddable viewport into public/, for the `bevy` renderer.
#
# Deliberately not part of `npm run build`: this needs a Rust toolchain and the
# wasm tools, and the renderer it produces is experimental.
#
# bevy-zoo is NOT part of rust/'s cargo workspace, and must not become part of it.
# That workspace pins Rust 1.98.0 and has its own .cargo/config.toml; bevy-zoo is
# edition 2024 on stable, and Bevy's dependency tree would land in the kcl
# lockfile. It keeps its own checkout and its own toolchain file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BEVY_ZOO_DIR="${BEVY_ZOO_DIR:-$ROOT/vendor/bevy-zoo}"
BEVY_ZOO_REMOTE="${BEVY_ZOO_REMOTE:-https://github.com/KittyCAD/bevy-zoo.git}"
BEVY_ZOO_REF="${BEVY_ZOO_REF:-frank/embeddable-viewport}"

for tool in cargo wasm-bindgen wasm-opt; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "error: $tool is required." >&2
    [ "$tool" = "cargo" ] || echo "  cargo install wasm-bindgen-cli wasm-opt" >&2
    exit 1
  fi
done

if [ ! -d "$BEVY_ZOO_DIR/.git" ]; then
  echo "Cloning bevy-zoo into $BEVY_ZOO_DIR"
  git clone --branch "$BEVY_ZOO_REF" "$BEVY_ZOO_REMOTE" "$BEVY_ZOO_DIR"
else
  # An existing checkout is left exactly as it is. This branch may only exist
  # locally, and silently checking something else out would throw away work.
  echo "Using bevy-zoo at $BEVY_ZOO_DIR ($(git -C "$BEVY_ZOO_DIR" rev-parse --abbrev-ref HEAD))"
fi

if [ ! -x "$BEVY_ZOO_DIR/scripts/build-embed.sh" ]; then
  echo "error: $BEVY_ZOO_DIR has no scripts/build-embed.sh — it predates the" >&2
  echo "       embeddable-viewport branch. Set BEVY_ZOO_REF or BEVY_ZOO_DIR." >&2
  exit 1
fi

"$BEVY_ZOO_DIR/scripts/build-embed.sh" "$ROOT/vendor/bevy-build"

# The two artifacts go to different homes, for the same reason kcl-wasm-lib's do:
# its glue is imported from rust/kcl-wasm-lib/pkg, and only kcl_wasm_lib_bg.wasm
# sits in public/.
#
# Vite refuses to let source code import anything under public/ - "it can only be
# referenced via HTML tags" - so the wasm-bindgen glue cannot live there. Under
# vendor/ it is an ordinary root-relative module that Vite transforms like any
# other. The .wasm is never imported, only fetched by URL, which is what public/
# is for.
mkdir -p "$ROOT/vendor/bevy" "$ROOT/public/bevy"
cp "$ROOT/vendor/bevy-build/bevy_zoo.js" "$ROOT/vendor/bevy/bevy_zoo.js"
cp "$ROOT/vendor/bevy-build/bevy_zoo_bg.wasm" "$ROOT/public/bevy/bevy_zoo_bg.wasm"
rm -rf "$ROOT/vendor/bevy-build"

# Bevy resolves its asset paths against the page, so `shaders/edge_line.wgsl` is
# fetched from `/assets/...`. Vite serves public/ at the root, which makes
# public/assets the only place these can go without patching the asset plugin.
rm -rf "$ROOT/public/assets"
mkdir -p "$ROOT/public/assets"
cp -R "$BEVY_ZOO_DIR/assets/." "$ROOT/public/assets/"

echo "Renderer installed:"
echo "  $ROOT/vendor/bevy/bevy_zoo.js       (imported as a module)"
echo "  $ROOT/public/bevy/bevy_zoo_bg.wasm  (fetched by URL)"
echo "  $ROOT/public/assets/                (Bevy asset root)"
echo
echo "Choose it in Settings -> Modeling -> Renderer, then reload."
