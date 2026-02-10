# AGENTS.md (Rust workspace)

## Scope

This file applies to Rust development under `rust/`. It complements the repo root README.

## Project overview

`rust/` contains the Rust crates that power KCL and related tooling, including:
- `kcl-lib` (core language and stdlib)
- `kcl-language-server` (LSP server + VSCode extension)
- `kcl-python-bindings` (PyO3 bindings)

## Dev environment tips

- Generated stdlib docs live under `docs/kcl-std/` and are overwritten by tests; do not edit them directly.

## Code style

- Format code using the nightly toolchain: `cargo +nightly fmt`.
- Follow clippy lints: `just lint`.

## Build and test

- Build the LSP (from `rust/kcl-language-server`): `npm install` then `cargo build`.
- Run KCL snapshot tests (requires a Zoo dev token):
  - `export ZOO_API_TOKEN=your-token-here`
  - `TWENTY_TWENTY=update cargo nextest run --workspace --no-fail-fast`
- Generate stdlib markdown docs (from `rust/`): `just redo-kcl-stdlib-docs`

## Simulation tests

- Create a new sim test: `just new-sim-test foo_bar`
- Run/update the sim test: `just overwrite-sim-test foo_bar`
- Inspect generated outputs and check for `execution_error.snap` before committing.

## Python bindings

- Uses `maturin` (install via `pipx install maturin` or `pip install maturin`).
- Common commands: `maturin build`, `maturin develop`, `maturin publish`.

## Standard library contributions (kcl-lib)

- Add new functions in `rust/kcl-lib/kcl/src/std` near similar entries.
- Provide doc comments with at least one example.
- Add the function to the `std_fn` list in `rust/kcl-lib/src/std/mod.rs`.
- After changes, run snapshot tests and regenerate stdlib docs.

## Release notes (Rust crates)

- Bump crate versions from `rust/`: `just bump-kcl-crate-versions`.
- Publish (after PR approval): `just publish-kcl {version}` (do not include `kcl-` prefix; the `just` task adds it).
- Tags from publish trigger releases for `kcl-python-bindings` and `kcl-language-server`.
