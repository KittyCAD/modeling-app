# Stdlib Extrude proof

`stdlibExtrude.ts` exercises the existing Extrude operation against an explicit
editor and execution snapshot. It adds no dialog or scene-picking interface.

The shared `extrudeCommandConfig` is the complete existing stdlib-derived
argument and presentation definition, including UI overrides, advanced parameters, conditional selection
requirements, defaults, documentation, and edit-flow arguments. The legacy
modeling command configuration uses that definition and adds its existing
machine-bound review adapter. The new host supplies review through `validate`.

`modelingCommandCodemods.Extrude.transform` invokes the existing `addExtrude`.
Its stdlib argument completeness checks remain in place. The legacy machine's
`run` adapter delegates to that transform, supplying its manager's artifact graph.
Both hosts also share experimental-feature annotation preparation.

## Prepare and apply

The caller supplies resolved `ExtrudeCommandArgs`, the current editor, an atomic
source/execution snapshot, and mock review validation for that snapshot:

```ts
const prepared = await prepareStdlibExtrude({
  editor,
  args,
  getExecution: () => currentExecution,
  wasmInstance,
  validate: (proposedAst, snapshot) => analysis.validate(proposedAst, snapshot),
})
if (prepared instanceof Error) return prepared
return prepared.commit()
```

The source must match the execution snapshot. Preparation and commit reject a
changed document, source path, execution snapshot, or closed target (represented
by `getExecution()` returning `undefined`). Moving the cursor is permitted.

The codemod still returns an AST and uses the existing recaster, which can change
formatting. CodeMirror's `diff` computes the separate text ranges between the
original document and the printed result. One transaction applies that `ChangeSet`
and maps the current selection; it does not replace the entire buffer. The
transaction is isolated from ordinary typing history. Saving and execution remain
the responsibility of the editor's contributions.

## Evidence and remaining bridge

The proof tests use the actual compiled WASM in mock execution mode. A KCL 3.0
circle produces its artifact graph; a typed point selection identifies that
sketch's region. The existing expression evaluator resolves a unit-bearing
length. The codemod creates a named parameter, hides the sketch, materializes a
region variable, and adds an extrusion. Mock execution of the result produces
a `Solid`. The editor receives multiple change ranges in one transaction, and
its cursor, undo, and redo behave as expected.

This verifies the programmatic codemod path without `KclManager` or an engine
connection. It does not verify real engine geometry, viewer-backed named-parameter
evaluation, or viewer-backed mock review. In an exploratory run, evaluating a
model variable after standalone mock execution did not retain that variable.
The viewer session still needs an explicit analysis/validation bridge with
appropriate model memory; the injected callback is that boundary, not a fallback
to syntax-only validation. The new UI should consume the shared definition after
that runtime bridge is established. Argument binding is also still a legacy
seam: `buildCommandArgument` and version-availability callbacks take a
modeling-machine context. This proof receives already-resolved arguments and
does not simulate that context or replace the selection/KCL input widgets.
