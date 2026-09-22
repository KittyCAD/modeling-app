# Temporary Face API runtime for TTC

This branch integrates the native KCL runtime changes from modeling-app PR
[#10607](https://github.com/KittyCAD/modeling-app/pull/10607) onto current main for
TTC preview and evaluation testing. It is independent of the author's branches.

## Provenance and scope

- Main base: `909de81d00ed318c7842520ad64757bdbc22e42a`.
- Face API source: `c2af0fe75ed69f6dbd3bf376b043a5febbdf1313`.
- Python package: `zoo-kcl` version `0.3.186+faceapi.1`.

The integration includes the PR's native runtime and lint changes, supporting
artifact types, standard-library declarations, and native regression tests.
In particular, face-based `fillet(edges)` and `chamfer(edges)` no longer require
`experimentalFeatures = allow`, and the Z0006 migration lint is enabled by
default. The Python bindings retain main's `ExecOutcome` return values and other
current APIs required by TTC's `zoo-mcp` dependency.

This is a Python runtime candidate, not an integration of the full Design Studio
UI. The PR's TypeScript selection overhaul and the sample migration in #12309
are outside this branch's scope. TTC retrieves examples separately from corpus
#22. Do not use this branch as a verdict on the full application's point-and-click
behavior.

## Using the candidate

After validating the build, pin an exact commit from this branch in TTC's shared
`pyproject.toml` dependency sources and regenerate `uv.lock`:

```toml
[tool.uv.sources]
zoo-kcl = { git = "https://github.com/KittyCAD/modeling-app", rev = "<validated integration commit>", subdirectory = "rust/kcl-python-bindings" }
```

Both the preview image and candidate eval worker must install from that lock.
The local version suffix distinguishes the candidate from the released wheel;
it does not publish a package or create a release tag. This branch does not
change TTC's dependency pin itself.

For a controlled baseline, use the main base above with matching TTC code,
request configuration, and engine. Track corpus or prompt changes separately
when attributing a result specifically to the runtime.

## Targeted compatibility checks

The Python test `test_face_api_edges_without_experimental_opt_in` checks fillet
and chamfer without an experimental setting, using both KCL preflight and the
real engine. It also checks that the result remains an `ExecOutcome` exposing
`issues()`, which is required by current MCP. Run engine checks against
`https://api.dev.zoo.dev` with an existing development token.

The upstream native regressions cover generated face tags on extruded sketch
segments, edge-reference artifact tracking, and edge-reference disambiguation.

## Validation before the rebase on 2026-09-21

The checks below were run on candidate `87c5997bfd207eef7055625442dcff8a76b2e7ca`,
based on main `5a9ca72692ca628e4f4e59be9f978848591252e2`. They are not validation
of the rebased candidate.

- `cargo check --locked -p kcl-python-bindings` passed.
- Built and installed the CPython 3.13 wheel in an isolated environment. Its
  version satisfies TTC/MCP's `zoo-kcl>=0.3.185` requirement, and `ExecOutcome`
  exposes both `issues()` and `render_sketch_png()`.
- All 38 targeted native runtime/lint tests passed.
- All 22 parser/unparser checks for the affected examples passed. The two new
  parser snapshots were updated for main's explicit `Program` type field.
- Both Python preflight cases passed: fillet and chamfer without the
  experimental setting.
- `just lint` passed, including all-feature workspace Clippy, default KCL
  Clippy, and Wasm Clippy.
- Rust formatting, Python test formatting, and type checking of the changed
  Python test file passed. Bindings and standard-library docs were regenerated
  with the repository commands.

Live geometry validation is pending. Both candidate engine cases failed with
the development engine's request for a WebSocket authorization header. The
unchanged `zoo-kcl==0.3.185` baseline produces the same authentication error with
the configured environment. These failures are not a geometry verdict.

The Python test file has 12 pre-existing Ruff findings (broad exception catches
and synchronous file reads). A comparison against the main-base file confirmed
no new findings. Package-wide type checking also reports 52 unresolved names in
the unchanged generated `kcl.pyi`; the changed test file itself passes.

The local wheel was built for this Linux host (`manylinux_2_39`) for validation;
it is not a portable deployment artifact. Use the pinned Git source or build a
wheel for the target environment when wiring this candidate into TTC. No package
or release tag has been published.
