# OCCT Command Core

Shared native/browser command boundary for the OpenCascade engine.

The C++ source in `src/occt_command_core.cpp` is compiled two ways:

- Native Rust CLI: `rust/kcl-lib/build.rs` links this source into `kcl-lib`.
- Browser: `scripts/build-wasm.sh` compiles the same source with Emscripten.

This first vertical slice owns the modeling protocol lifecycle and request
classification. Geometry-specific OCCT calls should be added behind the same C
ABI so the CLI and browser keep sharing the command semantics.
