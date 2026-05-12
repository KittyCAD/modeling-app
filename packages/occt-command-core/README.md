# OCCT Command Core

Shared native/browser command boundary for the OpenCascade engine.

The C++ source in `src/occt_command_core.cpp` is compiled two ways:

- Native Rust CLI: `rust/kcl-lib/build.rs` links this source into `kcl-lib`.
- Browser: `scripts/build-wasm.sh` compiles the same source with Emscripten.

The core owns the modeling protocol lifecycle and keeps a small geometry state
behind the same ABI for native and browser callers. By default it builds without
system OCCT so local development and CI stay portable. Set
`ZOO_OCCT_CORE_WITH_OCCT=1` and provide `OPENCASCADE_INCLUDE_DIR` /
`OPENCASCADE_LIB_DIR` to compile the geometry path against native OCCT.

The first OCCT-backed operations are protocol-level body producers such as
`extrude`, `revolve`, `sweep`, `loft`, booleans, patterns, and helix creation.
When native OCCT is enabled, the command core creates simple OCCT proxy shapes
for the covered solid operations and records their `BRepGProp` volume. Without
native OCCT, the same commands update protocol geometry state with deterministic
placeholder metadata so Rust and browser ABI tests exercise the same lifecycle.
