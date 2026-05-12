#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p dist

if ! command -v emcc >/dev/null 2>&1; then
  echo "emcc is required to build @zoo/occt-command-core WASM" >&2
  exit 127
fi

occt_flags=()
if [[ "${ZOO_OCCT_CORE_WITH_OCCT:-}" == "1" ]]; then
  occt_flags+=("-DZOO_OCCT_CORE_WITH_OCCT=1")
  if [[ -n "${OPENCASCADE_INCLUDE_DIR:-}" ]]; then
    occt_flags+=("-I${OPENCASCADE_INCLUDE_DIR}")
  fi
  if [[ -n "${OPENCASCADE_LIB_DIR:-}" ]]; then
    occt_flags+=("-L${OPENCASCADE_LIB_DIR}")
  fi
  occt_flags+=("-lTKPrim" "-lTKBRep" "-lTKTopAlgo" "-lTKGProp" "-lTKGeomBase" "-lTKG3d" "-lTKG2d" "-lTKMath" "-lTKernel")
fi

emcc src/occt_command_core.cpp \
  -std=c++17 \
  -O3 \
  "${occt_flags[@]}" \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS='["_zoo_occt_core_version","_zoo_occt_core_has_native_occt","_zoo_occt_core_start_new_session","_zoo_occt_core_record_rollback_marker","_zoo_occt_core_handle_modeling_command","_zoo_occt_core_debug_geometry_state","_zoo_occt_core_free","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap","UTF8ToString","stringToUTF8","lengthBytesUTF8","_malloc","_free"]' \
  -o dist/occt-command-core.js
